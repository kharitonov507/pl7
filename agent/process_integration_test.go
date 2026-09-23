package main

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Runs the compiled executable, not just in-process methods. Opt-in binary path.
func TestNativeProcessOfflineCrashAndRestart(t *testing.T) {
	binary := os.Getenv("DOOH_TEST_AGENT_BINARY")
	if binary == "" {
		t.Skip("set DOOH_TEST_AGENT_BINARY to the compiled native executable")
	}
	binary, e := filepath.Abs(binary)
	if e != nil {
		t.Fatal(e)
	}
	b := []byte("process integration image bytes")
	m := testManifest(assetFor(b))
	var offline atomic.Bool
	var received atomic.Int64
	cms := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if offline.Load() {
			w.WriteHeader(503)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifest"):
			sendJSON(w, 200, m)
		case r.URL.Path == m.Assets[0].URL:
			w.Write(b)
		case strings.HasSuffix(r.URL.Path, "/events"):
			var input struct {
				Events []Event `json:"events"`
			}
			json.NewDecoder(r.Body).Decode(&input)
			ids := []string{}
			for _, e := range input.Events {
				ids = append(ids, e.EventID)
			}
			received.Add(int64(len(ids)))
			sendJSON(w, 200, map[string]any{"acknowledged": ids})
		case strings.HasSuffix(r.URL.Path, "/heartbeat"):
			w.WriteHeader(200)
		default:
			w.WriteHeader(404)
		}
	}))
	defer cms.Close()
	c := testConfig(t)
	c.CMS = cms.URL
	c.PollSeconds = 1
	listener, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	c.Listen = listener.Addr().String()
	listener.Close()
	configFile := filepath.Join(t.TempDir(), "config.json")
	raw, _ := json.Marshal(c)
	if e = os.WriteFile(configFile, raw, 0600); e != nil {
		t.Fatal(e)
	}
	base := "http://" + c.Listen
	client := &http.Client{Timeout: time.Second}
	var cmd *exec.Cmd
	var log bytes.Buffer
	launch := func() {
		t.Helper()
		log.Reset()
		cmd = exec.Command(binary, "-config", configFile)
		cmd.Stdout = &log
		cmd.Stderr = &log
		if e := cmd.Start(); e != nil {
			t.Fatal(e)
		}
	}
	stop := func() {
		if cmd != nil {
			cmd.Process.Kill()
			cmd.Wait()
			cmd = nil
		}
	}
	defer stop()
	launch()
	var token string
	waitFor := func(label string, condition func() bool) {
		t.Helper()
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			if condition() {
				return
			}
			time.Sleep(25 * time.Millisecond)
		}
		t.Fatal("timeout: " + label)
	}
	waitFor("bridge startup", func() bool {
		res, e := client.Get(base + "/")
		if e != nil {
			return false
		}
		res.Body.Close()
		for _, cookie := range res.Cookies() {
			token = cookie.Value
		}
		return res.StatusCode == 200 && token != ""
	})
	state := func() State {
		req, _ := http.NewRequest("GET", base+"/api/state", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		res, e := client.Do(req)
		if e != nil {
			return State{}
		}
		defer res.Body.Close()
		var s State
		json.NewDecoder(res.Body).Decode(&s)
		return s
	}
	post := func(path string, data any) {
		t.Helper()
		raw, _ := json.Marshal(data)
		req, _ := http.NewRequest("POST", base+path, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res, e := client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatal(path, res.StatusCode)
		}
	}
	waitFor("download and prepared schedule", func() bool { s := state(); return s.Online && s.Current != nil && s.CacheCount == 1 })
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	conn, _, e := websocket.Dial(ctx, "ws://"+c.Listen+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}})
	if e != nil {
		t.Fatal(e)
	}
	go func() {
		for {
			if _, _, e := conn.Read(ctx); e != nil {
				return
			}
		}
	}()
	first := state().Current.SessionID
	post("/api/report", Report{Kind: "alive", Visible: true})
	post("/api/report", Report{Kind: "ready", SessionID: first})
	waitFor("first event ACK", func() bool { return received.Load() >= 1 && state().Queue == 0 })
	offline.Store(true)
	post("/api/command", IncomingCommand{ID: "offline-next", Action: "next"})
	waitFor("offline keeps local media and queue", func() bool { s := state(); return !s.Online && s.Queue >= 1 && s.Current != nil && s.CacheCount == 1 })
	session := state().Current.SessionID
	post("/api/report", Report{Kind: "ready", SessionID: session})
	post("/api/command", IncomingCommand{ID: "persist-pause", Action: "pause"})
	stop()
	conn.CloseNow()
	launch()
	waitFor("restart recovers without CMS", func() bool { s := state(); return s.Current != nil && s.CacheCount == 1 && s.Paused && s.Queue >= 3 })
	// After abrupt death old ready session must be interrupted, not silently reused.
	if s := state(); s.Current.SessionID == session {
		t.Fatal("old session silently resumed after crash")
	}
	offline.Store(false)
	waitFor("reconnected event ACK drains persisted queue", func() bool { s := state(); return s.Online && s.Queue == 0 })
	post("/api/command", IncomingCommand{ID: "persist-pause", Action: "pause"})
	if !state().Paused {
		t.Fatal("durable command duplicate changed state")
	}
	stop()
}
