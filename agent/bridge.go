package main

import (
	"context"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"io/fs"
	"net/http"
	"net/url"
	"strings"
	"time"
)

//go:embed web/*
var webFiles embed.FS

func (a *Agent) authorized(r *http.Request) bool {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if cookie, err := r.Cookie("dooh_bridge_" + a.cfg.DeviceID); err == nil && token == "" {
		token = cookie.Value
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(a.token)) == 1
}
func (a *Agent) allowedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || origin == "http://"+a.cfg.Listen
}
func sendJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
func (a *Agent) handler() http.Handler {
	mux := http.NewServeMux()
	files, _ := fs.Sub(webFiles, "web")
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" && r.URL.Path != "/renderer.js" && r.URL.Path != "/style.css" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			// No credential bootstrap on cross-site navigation/fetch. Local processes remain trusted.
			if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
				http.Error(w, "cross-site bootstrap refused", 403)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "dooh_bridge_" + a.cfg.DeviceID, Value: a.token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
		}
		http.FileServer(http.FS(files)).ServeHTTP(w, r)
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		sendJSON(w, 200, map[string]any{"ok": true, "agentVersion": version})
	})
	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		s := a.snapshot()
		bit := func(v bool) int {
			if v {
				return 1
			}
			return 0
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		fmt.Fprintf(w, "# TYPE dooh_agent_online gauge\ndooh_agent_online %d\n# TYPE dooh_renderer_healthy gauge\ndooh_renderer_healthy %d\n# TYPE dooh_event_queue gauge\ndooh_event_queue %d\n# TYPE dooh_cache_bytes gauge\ndooh_cache_bytes %d\n# TYPE dooh_cache_quota_bytes gauge\ndooh_cache_quota_bytes %d\n# TYPE dooh_mqtt_connected gauge\ndooh_mqtt_connected %d\n# TYPE dooh_uptime_seconds gauge\ndooh_uptime_seconds %d\n", bit(s.Online), bit(s.RendererHealthy), s.Queue, s.CacheBytes, s.QuotaBytes, bit(s.MQTTConnected), s.UptimeSeconds)
	})
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) { sendJSON(w, 200, a.snapshot()) })
	mux.HandleFunc("/api/report", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var report Report
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&report); err != nil {
			http.Error(w, "bad report", 400)
			return
		}
		if len(report.Detail) > 240 {
			report.Detail = report.Detail[:240]
		}
		if err := a.report(report); err != nil {
			http.Error(w, err.Error(), 409)
			return
		}
		sendJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/command", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		var command IncomingCommand
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&command); err != nil {
			http.Error(w, "bad command", 400)
			return
		}
		if err := a.applyCommand(command); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		sendJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/media/", func(w http.ResponseWriter, r *http.Request) {
		hash := strings.TrimPrefix(r.URL.Path, "/media/")
		file, err := a.cache.path(hash)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		a.mu.Lock()
		mime := ""
		if a.manifest != nil {
			for _, asset := range neededAssets(*a.manifest) {
				if asset.SHA256 == hash {
					mime = asset.Type
					break
				}
			}
		}
		a.mu.Unlock()
		if mime == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", mime)
		http.ServeFile(w, r, file)
	})
	mux.HandleFunc("/ws", a.websocket)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors "+a.cfg.CMS)
		// Host validation prevents DNS rebinding; Origin protects writes and WebSocket upgrades.
		if r.Host != a.cfg.Listen {
			http.Error(w, "unexpected bridge Host", 403)
			return
		}
		if !a.allowedOrigin(r) {
			http.Error(w, "unexpected bridge Origin", 403)
			return
		}
		if (strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/media/") || r.URL.Path == "/ws" || r.URL.Path == "/metrics") && !a.authorized(r) {
			http.Error(w, "bridge authentication required", 401)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (a *Agent) websocket(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	if a.rendererConnected {
		a.mu.Unlock()
		http.Error(w, "one active renderer allowed", 409)
		return
	}
	a.rendererConnected = true
	a.rendererWG.Add(1)
	a.lastAlive = time.Now()
	a.mu.Unlock()
	defer func() {
		defer a.rendererWG.Done()
		a.mu.Lock()
		defer a.mu.Unlock()
		a.rendererConnected = false
		a.rendererVisible = false
		if err := a.finish("interrupted", "Renderer connection lost; new session required"); err != nil {
			a.problem = err.Error()
		} else {
			a.selectPlaylist(time.Now())
		}
	}()
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(8192)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	// Reports use durable HTTP ACKs; WS is the realtime state/instruction channel.
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		b, _ := json.Marshal(a.snapshot())
		writeCtx, done := context.WithTimeout(ctx, 3*time.Second)
		err = conn.Write(writeCtx, websocket.MessageText, b)
		done()
		if err != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func sameOriginURL(raw, base string) bool {
	u, e := url.Parse(raw)
	b, err := url.Parse(base)
	return e == nil && err == nil && u.Scheme == b.Scheme && u.Host == b.Host
}
