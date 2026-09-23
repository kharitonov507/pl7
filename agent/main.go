package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func main() {
	showVersion := flag.Bool("version", false, "print agent version")
	configPath := flag.String("config", "config.example.json", "configuration file")
	device := flag.String("device", "", "override device ID")
	listen := flag.String("listen", "", "override loopback bridge address")
	data := flag.String("data", "", "override agent data directory")
	mqttTopic := flag.String("mqtt-topic", "", "override unique device MQTT topic prefix")
	ota := flag.String("stage-ota", "", "verify and stage a signed update manifest; never auto-install")
	flag.Parse()
	if *showVersion {
		log.Print("DOOH agent " + version)
		return
	}
	c, err := loadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	if *device != "" {
		if !devicePattern.MatchString(*device) {
			log.Fatal("invalid device ID")
		}
		c.DeviceID = *device
	}
	if *listen != "" {
		c.Listen = *listen
		if err = validateListen(c.Listen); err != nil {
			log.Fatal(err)
		}
	}
	if *data != "" {
		c.DataDir = *data
	}
	if *mqttTopic != "" {
		c.MQTTTopic = *mqttTopic
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	a, err := newAgent(c)
	if err != nil {
		log.Fatal(err)
	}
	defer a.close()
	a.cache.Token = os.Getenv("DOOH_CMS_TOKEN")
	if *ota != "" {
		if err = a.stageOTA(ctx, *ota); err != nil {
			log.Fatal(err)
		}
		log.Print("Signed update staged; installation not performed")
		return
	}
	listener, err := net.Listen("tcp", c.Listen)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: c.Listen, Handler: a.handler(), BaseContext: func(net.Listener) context.Context { return ctx }, ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	var workers sync.WaitGroup
	run := func(fn func(context.Context)) { workers.Add(1); go func() { defer workers.Done(); fn(ctx) }() }
	go func() {
		log.Printf("%s Go-agent %s: http://%s/", c.DeviceID, version, c.Listen)
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("Bridge failed: %v", err)
			cancel()
		}
	}()
	run(a.syncLoop)
	run(a.supervise)
	run(a.startMQTT)
	notifySystemd("READY=1")
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	watch := time.NewTicker(watchdogInterval())
	defer watch.Stop()
	for {
		select {
		case <-ctx.Done():
			notifySystemd("STOPPING=1")
			shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
			server.Shutdown(shutdown)
			done()
			workers.Wait()
			a.rendererWG.Wait()
			return
		case now := <-tick.C:
			a.tick(now)
		case <-watch.C:
			notifySystemd("WATCHDOG=1")
		}
	}
}
