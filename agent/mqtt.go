package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func mqttOptions(c Config) (*mqtt.ClientOptions, error) {
	u, err := url.Parse(c.MQTTBroker)
	if err != nil || u.Host == "" || u.User != nil {
		return nil, errors.New("invalid MQTT broker URL")
	}
	ip := net.ParseIP(u.Hostname())
	local := u.Hostname() == "localhost" || ip != nil && ip.IsLoopback()
	secure := u.Scheme == "ssl" || u.Scheme == "tls" || u.Scheme == "wss"
	if !secure && !(local && u.Scheme == "tcp") {
		return nil, errors.New("remote MQTT requires TLS")
	}
	if !strings.HasPrefix(c.MQTTTopic, "dooh/") || strings.ContainsAny(c.MQTTTopic, "+#\x00") {
		return nil, errors.New("invalid device MQTT topic")
	}
	options := mqtt.NewClientOptions().AddBroker(c.MQTTBroker).SetClientID("dooh-" + c.DeviceID).SetAutoReconnect(true).SetConnectRetry(true).SetConnectTimeout(5 * time.Second).SetKeepAlive(15 * time.Second).SetPingTimeout(5 * time.Second).SetCleanSession(false)
	options.SetUsername(os.Getenv("DOOH_MQTT_USER")).SetPassword(os.Getenv("DOOH_MQTT_PASSWORD"))
	options.SetStore(mqtt.NewFileStore(filepath.Join(c.DataDir, "mqtt-spool")))
	options.SetWill(c.MQTTTopic+"/status", `{"online":false}`, 1, true)
	if secure {
		config := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: u.Hostname()}
		if c.MQTTCA != "" {
			b, err := os.ReadFile(c.MQTTCA)
			if err != nil {
				return nil, err
			}
			pool, err := x509.SystemCertPool()
			if err != nil {
				pool = x509.NewCertPool()
			}
			if !pool.AppendCertsFromPEM(b) {
				return nil, errors.New("invalid MQTT CA certificate")
			}
			config.RootCAs = pool
		}
		options.SetTLSConfig(config)
	}
	return options, nil
}
func (a *Agent) startMQTT(ctx context.Context) {
	if a.cfg.MQTTBroker == "" {
		return
	}
	options, err := mqttOptions(a.cfg)
	if err != nil {
		log.Printf("MQTT disabled: %v", err)
		return
	}
	options.OnConnectionLost = func(_ mqtt.Client, err error) {
		a.mu.Lock()
		a.mqttConnected = false
		a.mu.Unlock()
		log.Printf("MQTT disconnected: %v", err)
	}
	options.OnConnect = func(client mqtt.Client) {
		client.Publish(a.cfg.MQTTTopic+"/status", 1, true, `{"online":true}`)
		subscription := client.Subscribe(a.cfg.MQTTTopic+"/cmd", 1, func(client mqtt.Client, message mqtt.Message) {
			if len(message.Payload()) > 4096 {
				return
			}
			var c IncomingCommand
			if err := json.Unmarshal(message.Payload(), &c); err != nil {
				return
			}
			// Retained commands may be stale. Require an explicit fresh publish.
			if message.Retained() {
				return
			}
			err := a.applyCommand(c)
			ack := map[string]any{"commandId": c.ID, "ok": err == nil}
			if err != nil {
				ack["error"] = err.Error()
			}
			b, _ := json.Marshal(ack)
			client.Publish(a.cfg.MQTTTopic+"/ack", 1, false, b)
		})
		if !subscription.WaitTimeout(5*time.Second) || subscription.Error() != nil {
			log.Print("MQTT command subscription failed")
			return
		}
		a.mu.Lock()
		a.mqttConnected = true
		a.mu.Unlock()
	}
	client := mqtt.NewClient(options)
	client.Connect()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			if client.IsConnected() {
				t := client.Publish(a.cfg.MQTTTopic+"/status", 1, true, `{"online":false}`)
				t.WaitTimeout(time.Second)
			}
			client.Disconnect(500)
			return
		case <-ticker.C:
			if client.IsConnected() {
				b, _ := json.Marshal(a.snapshot())
				client.Publish(a.cfg.MQTTTopic+"/telemetry", 0, false, b)
			}
		}
	}
}
