package main

import (
	"context"
	"encoding/json"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"os"
	"testing"
	"time"
)

// Opt-in: local test broker. No production credentials or external broker used.
func TestMQTTLiveCommandACKAndDedup(t *testing.T) {
	broker := os.Getenv("DOOH_TEST_MQTT")
	if broker == "" {
		t.Skip("set DOOH_TEST_MQTT to a local lab broker")
	}
	a := testAgent(t)
	installManifest(t, a, []byte("mqtt image"))
	a.cfg.MQTTBroker = broker
	a.cfg.MQTTTopic = "dooh/lab/test-" + newID()
	options := mqtt.NewClientOptions().AddBroker(broker).SetClientID("test-publisher-" + newID()).SetConnectTimeout(3 * time.Second)
	publisher := mqtt.NewClient(options)
	token := publisher.Connect()
	if !token.WaitTimeout(5*time.Second) || token.Error() != nil {
		t.Fatal("publisher connect", token.Error())
	}
	defer publisher.Disconnect(250)
	acks := make(chan IncomingCommand, 10)
	token = publisher.Subscribe(a.cfg.MQTTTopic+"/ack", 1, func(_ mqtt.Client, m mqtt.Message) {
		var ack struct {
			CommandID string `json:"commandId"`
			OK        bool   `json:"ok"`
		}
		if json.Unmarshal(m.Payload(), &ack) == nil && ack.OK {
			acks <- IncomingCommand{ID: ack.CommandID}
		}
	})
	if !token.WaitTimeout(3*time.Second) || token.Error() != nil {
		t.Fatal("ACK subscribe", token.Error())
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { a.startMQTT(ctx); close(done) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("MQTT shutdown timeout")
		}
	}()
	deadline := time.Now().Add(5 * time.Second)
	for !a.snapshot().MQTTConnected && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !a.snapshot().MQTTConnected {
		t.Fatal("agent did not connect")
	}
	// Ready state must mean subscription was acknowledged, not just TCP connected.
	publish := func(c IncomingCommand) {
		t.Helper()
		b, _ := json.Marshal(c)
		token := publisher.Publish(a.cfg.MQTTTopic+"/cmd", 1, false, b)
		if !token.WaitTimeout(3*time.Second) || token.Error() != nil {
			t.Fatal("publish", token.Error())
		}
		select {
		case ack := <-acks:
			if ack.ID != c.ID {
				t.Fatal("wrong ACK", ack.ID)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("missing durable command ACK")
		}
	}
	original := a.snapshot().Current.SessionID
	cmd := IncomingCommand{ID: "mqtt-next", Action: "next"}
	publish(cmd)
	next := a.snapshot().Current.SessionID
	if next == original {
		t.Fatal("command not executed")
	}
	publish(cmd)
	if a.snapshot().Current.SessionID != next {
		t.Fatal("QoS duplicate advanced twice")
	}
	publish(IncomingCommand{ID: "mqtt-pause", Action: "pause"})
	if !a.snapshot().Paused {
		t.Fatal("pause not executed")
	}
}
