package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func assetFor(b []byte) Asset {
	h := sha256.Sum256(b)
	return Asset{ID: "test", Name: "Test", Type: "image/png", URL: "/media/test", Size: int64(len(b)), SHA256: hex.EncodeToString(h[:])}
}
func testConfig(t *testing.T) Config {
	t.Helper()
	return Config{DeviceID: "test-device", CMS: "http://127.0.0.1:8787", Listen: "127.0.0.1:8791", DataDir: t.TempDir(), CacheBytes: 1 << 20, PollSeconds: 1, RendererTimeoutSeconds: 5}
}
func testAgent(t *testing.T) *Agent {
	t.Helper()
	a, e := newAgent(testConfig(t))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(a.close)
	return a
}
func testManifest(asset Asset) Manifest {
	return Manifest{DeviceID: "test-device", Name: "Test", Version: 1, Assets: []Asset{asset}, Playlists: []Playlist{{ID: "main", Name: "Main", Items: []Item{{AssetID: asset.ID, Duration: 5}}}, {ID: "fallback", Name: "Fallback", Items: []Item{{AssetID: asset.ID, Duration: 5}}}}, Schedule: Schedule{PlaylistID: "main", FallbackID: "fallback"}}
}
func installManifest(t *testing.T, a *Agent, b []byte) {
	t.Helper()
	asset := assetFor(b)
	if e := os.MkdirAll(a.cache.Dir, 0700); e != nil {
		t.Fatal(e)
	}
	p, _ := a.cache.path(asset.SHA256)
	if e := os.WriteFile(p, b, 0600); e != nil {
		t.Fatal(e)
	}
	m := testManifest(asset)
	if e := writeMeta(a.db, "manifest", m); e != nil {
		t.Fatal(e)
	}
	a.manifest = &m
	a.selectPlaylist(time.Now())
}

func TestDataDirectoryExclusiveLock(t *testing.T) {
	c := testConfig(t)
	a, e := newAgent(c)
	if e != nil {
		t.Fatal(e)
	}
	if second, e := newAgent(c); e == nil {
		second.close()
		t.Fatal("second process acquired device directory")
	}
	a.close()
	a, e = newAgent(c)
	if e != nil {
		t.Fatal(e)
	}
	a.close()
}
func TestManifestValidation(t *testing.T) {
	m := testManifest(assetFor([]byte("test")))
	if e := validateManifest(m, "test-device", 100); e != nil {
		t.Fatal(e)
	}
	m.Assets[0].Type = "text/html"
	if e := validateManifest(m, "test-device", 100); e == nil {
		t.Fatal("unsafe MIME accepted")
	}
	m.Assets[0].Type = "image/png"
	if e := validateManifest(m, "another", 100); e == nil {
		t.Fatal("other device accepted")
	}
	if e := validateManifest(m, "test-device", 1); e == nil {
		t.Fatal("oversize manifest accepted")
	}
}
func TestResumableDownloadAndHash(t *testing.T) {
	b := []byte("0123456789abcdefgh")
	asset := assetFor(b)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Write(b[:7])
			return
		}
		if r.Header.Get("Range") != "bytes=7-" {
			t.Errorf("range = %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 7-%d/%d", len(b)-1, len(b)))
		w.WriteHeader(206)
		w.Write(b[7:])
	}))
	defer server.Close()
	c := Cache{Dir: t.TempDir(), Quota: 100, Client: server.Client(), CMS: server.URL}
	if e := c.fetch(context.Background(), asset, nil); e == nil {
		t.Fatal("short response accepted")
	}
	if e := c.fetch(context.Background(), asset, nil); e != nil {
		t.Fatal(e)
	}
	p, _ := c.path(asset.SHA256)
	h, e := fileHash(p)
	if e != nil || h != asset.SHA256 {
		t.Fatal(h, e)
	}
	if _, e = os.Stat(p + ".part"); !os.IsNotExist(e) {
		t.Fatal("partial retained after commit")
	}
}
func TestDownloadServerIgnoresRange(t *testing.T) {
	b := []byte("complete payload")
	asset := assetFor(b)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(b) }))
	defer server.Close()
	c := Cache{Dir: t.TempDir(), Quota: int64(len(b)), Client: server.Client(), CMS: server.URL}
	p, _ := c.path(asset.SHA256)
	os.WriteFile(p+".part", b[:3], 0600)
	if e := c.fetch(context.Background(), asset, nil); e != nil {
		t.Fatal(e)
	}
	h, _ := fileHash(p)
	if h != asset.SHA256 {
		t.Fatal("200 response appended instead of replacing")
	}
}
func TestCorruptDownloadNeverPublished(t *testing.T) {
	asset := assetFor([]byte("good"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("evil")) }))
	defer server.Close()
	c := Cache{Dir: t.TempDir(), Quota: 100, Client: server.Client(), CMS: server.URL}
	if e := c.fetch(context.Background(), asset, nil); e == nil {
		t.Fatal("bad hash accepted")
	}
	p, _ := c.path(asset.SHA256)
	if _, e := os.Stat(p); !os.IsNotExist(e) {
		t.Fatal("corrupt media published")
	}
	if _, e := os.Stat(p + ".part"); !os.IsNotExist(e) {
		t.Fatal("corrupt partial retained")
	}
}
func TestCacheQuotaPreservesPinnedAndUnknownFiles(t *testing.T) {
	c := Cache{Dir: t.TempDir(), Quota: 10}
	one := assetFor([]byte("11111"))
	two := assetFor([]byte("22222"))
	p1, _ := c.path(one.SHA256)
	p2, _ := c.path(two.SHA256)
	os.WriteFile(p1, []byte("11111"), 0600)
	os.WriteFile(p2, []byte("22222"), 0600)
	unknown := filepath.Join(c.Dir, "user-notes.txt")
	os.WriteFile(unknown, []byte("notes"), 0600)
	if e := c.reserve(5, map[string]bool{one.SHA256: true}, ""); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(p1); e != nil {
		t.Fatal("pinned file removed")
	}
	if _, e := os.Stat(unknown); e != nil {
		t.Fatal("unowned file removed")
	}
	if _, e := os.Stat(p2); !os.IsNotExist(e) {
		t.Fatal("obsolete file not evicted")
	}
	if e := c.reserve(6, map[string]bool{one.SHA256: true}, ""); e == nil {
		t.Fatal("quota overflow accepted")
	}
}
func TestCommandDedupAndDurableRecovery(t *testing.T) {
	c := testConfig(t)
	a, e := newAgent(c)
	if e != nil {
		t.Fatal(e)
	}
	installManifest(t, a, []byte("test image"))
	a.rendererVisible = true
	session := a.current.SessionID
	if e = a.report(Report{Kind: "ready", SessionID: session}); e != nil {
		t.Fatal(e)
	}
	cmd := IncomingCommand{ID: "same-command", Action: "next"}
	if e = a.applyCommand(cmd); e != nil {
		t.Fatal(e)
	}
	next := a.current.SessionID
	if e = a.applyCommand(cmd); e != nil || next != a.current.SessionID {
		t.Fatal("duplicate advanced twice", e)
	}
	if e = a.report(Report{Kind: "ready", SessionID: session}); e == nil {
		t.Fatal("stale renderer accepted")
	}
	if e = a.applyCommand(IncomingCommand{ID: "pause1", Action: "pause"}); e != nil {
		t.Fatal(e)
	}
	a.close()
	a, e = newAgent(c)
	if e != nil {
		t.Fatal(e)
	}
	defer a.close()
	if !a.paused || a.manifest == nil || a.current == nil {
		t.Fatal("state not restored")
	}
	restored := a.current.SessionID
	if e = a.applyCommand(cmd); e != nil || a.current.SessionID != restored {
		t.Fatal("command dedup not persisted", e)
	}
	events, e := pendingEvents(a.db)
	if e != nil || len(events) != 2 {
		t.Fatal("expected started + interrupted", events, e)
	}
}
func TestPoPAcknowledgementOnlyRemovesSentIDs(t *testing.T) {
	a := testAgent(t)
	one := Event{EventID: "one"}
	two := Event{EventID: "two"}
	writeEvent(a.db, one)
	writeEvent(a.db, two)
	writeEvent(a.db, one)
	if e := acknowledge(a.db, []Event{one}, []string{"one", "two", "foreign"}); e != nil {
		t.Fatal(e)
	}
	events, _ := pendingEvents(a.db)
	if len(events) != 1 || events[0].EventID != "two" {
		t.Fatal(events)
	}
}
func TestImageCheckpointAndFallback(t *testing.T) {
	a := testAgent(t)
	installManifest(t, a, []byte("test image"))
	now := time.Now()
	a.rendererConnected = true
	a.rendererVisible = true
	a.lastAlive = now
	a.report(Report{Kind: "ready", SessionID: a.current.SessionID})
	a.lastTick = now.Add(-500 * time.Millisecond)
	a.tick(now)
	var checkpoint *Playback
	if e := readMeta(a.db, "active", &checkpoint); e != nil || checkpoint == nil || checkpoint.PlayedMS < 490 || checkpoint.CheckpointAt == "" {
		t.Fatal(checkpoint, e)
	}
	end := now.Add(-time.Second).UTC().Format(time.RFC3339Nano)
	a.manifest.Schedule.EndsAt = &end
	a.tick(now.Add(time.Millisecond))
	if a.playlistID != "fallback" {
		t.Fatal("local fallback did not start")
	}
}
func TestBridgeAuthOriginHostMetrics(t *testing.T) {
	a := testAgent(t)
	h := a.handler()
	request := func(path, host, origin, token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://"+host+path, nil)
		r.Header.Set("Origin", origin)
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request("/api/state", a.cfg.Listen, "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request("/api/state", a.cfg.Listen, "http://evil.example", a.token); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := request("/api/state", "evil.example", "", a.token); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := request("/metrics", a.cfg.Listen, "", a.token); w.Code != 200 || !strings.Contains(w.Body.String(), "dooh_event_queue") {
		t.Fatal(w.Code, w.Body.String())
	}
	r := httptest.NewRequest("GET", "http://"+a.cfg.Listen+"/", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 || len(w.Result().Cookies()) != 0 {
		t.Fatal("cross-site cookie bootstrap accepted")
	}
}
func TestWebSocketSingleRendererAndReconnect(t *testing.T) {
	a := testAgent(t)
	installManifest(t, a, []byte("test image"))
	server := httptest.NewServer(a.handler())
	a.cfg.Listen = strings.TrimPrefix(server.URL, "http://")
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	header := http.Header{"Authorization": []string{"Bearer " + a.token}}
	conn, _, e := websocket.Dial(ctx, strings.Replace(server.URL, "http:", "ws:", 1)+"/ws", &websocket.DialOptions{HTTPHeader: header})
	if e != nil {
		t.Fatal(e)
	}
	_, raw, e := conn.Read(ctx)
	if e != nil {
		t.Fatal(e)
	}
	var s State
	json.Unmarshal(raw, &s)
	if s.DeviceID != a.cfg.DeviceID || s.Current == nil {
		t.Fatal(string(raw))
	}
	second, res, e := websocket.Dial(ctx, strings.Replace(server.URL, "http:", "ws:", 1)+"/ws", &websocket.DialOptions{HTTPHeader: header})
	if e == nil {
		second.CloseNow()
		t.Fatal("second renderer accepted")
	}
	if res == nil || res.StatusCode != 409 {
		t.Fatal(res, e)
	}
	a.report(Report{Kind: "ready", SessionID: s.Current.SessionID})
	conn.CloseNow()
	a.rendererWG.Wait()
	if a.current.SessionID == s.Current.SessionID || a.rendererConnected {
		t.Fatal("disconnected session reused")
	}
}
func signUpdate(t *testing.T, p UpdatePayload, private ed25519.PrivateKey) []byte {
	t.Helper()
	raw, e := json.Marshal(p)
	if e != nil {
		t.Fatal(e)
	}
	b, e := json.Marshal(UpdateEnvelope{Payload: base64.StdEncoding.EncodeToString(raw), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(private, raw))})
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func TestSignedOTAStagesButDoesNotExecuteAndRejectsReplay(t *testing.T) {
	a := testAgent(t)
	b := []byte("not an executable - candidate only")
	asset := assetFor(b)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(b) }))
	defer server.Close()
	pub, private, e := ed25519.GenerateKey(rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	a.cfg.OTAPublicKey = base64.StdEncoding.EncodeToString(pub)
	p := UpdatePayload{Version: "0.3.0", Sequence: 1, OS: runtime.GOOS, Arch: runtime.GOARCH, URL: server.URL, SHA256: asset.SHA256, Size: asset.Size}
	file := filepath.Join(t.TempDir(), "signed.json")
	raw := signUpdate(t, p, private)
	os.WriteFile(file, raw, 0600)
	if e = a.stageOTA(context.Background(), file); e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(a.cfg.DataDir, "updates", asset.SHA256+".candidate")); e != nil {
		t.Fatal(e)
	}
	if e = a.stageOTA(context.Background(), file); e == nil {
		t.Fatal("replay accepted")
	}
	var env UpdateEnvelope
	json.Unmarshal(raw, &env)
	env.Payload = base64.StdEncoding.EncodeToString([]byte("{}"))
	bad, _ := json.Marshal(env)
	if _, e = verifyUpdate(bad, a.cfg.OTAPublicKey); e == nil {
		t.Fatal("tampered signature accepted")
	}
	p.Arch = "wrong-platform"
	if _, e = verifyUpdate(signUpdate(t, p, private), a.cfg.OTAPublicKey); e == nil {
		t.Fatal("wrong platform accepted")
	}
}
func TestMQTTTransportValidation(t *testing.T) {
	c := testConfig(t)
	c.MQTTTopic = "dooh/lab/test-device"
	c.MQTTBroker = "tcp://remote.example:1883"
	if _, e := mqttOptions(c); e == nil {
		t.Fatal("remote plaintext accepted")
	}
	c.MQTTBroker = "ssl://broker.example:8883"
	options, e := mqttOptions(c)
	if e != nil || options.TLSConfig == nil || options.TLSConfig.InsecureSkipVerify {
		t.Fatal(e)
	}
	c.MQTTTopic = "dooh/#"
	if _, e = mqttOptions(c); e == nil {
		t.Fatal("wildcard topic accepted")
	}
}
func TestSyncOfflineKeepsPreparedManifestAndQueue(t *testing.T) {
	a := testAgent(t)
	b := []byte("sync image")
	m := testManifest(assetFor(b))
	acknowledgeEvents := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/manifest"):
			sendJSON(w, 200, m)
		case r.URL.Path == m.Assets[0].URL:
			w.Write(b)
		case strings.HasSuffix(r.URL.Path, "/events"):
			if !acknowledgeEvents {
				w.WriteHeader(503)
				return
			}
			var input struct {
				Events []Event `json:"events"`
			}
			json.NewDecoder(r.Body).Decode(&input)
			ids := []string{}
			for _, e := range input.Events {
				ids = append(ids, e.EventID)
			}
			sendJSON(w, 200, map[string]any{"acknowledged": ids})
		case strings.HasSuffix(r.URL.Path, "/heartbeat"):
			w.WriteHeader(200)
		default:
			w.WriteHeader(404)
		}
	}))
	a.cfg.CMS = server.URL
	a.cache.CMS = server.URL
	if e := a.syncOnce(context.Background()); e != nil {
		t.Fatal(e)
	}
	session := a.current.SessionID
	a.report(Report{Kind: "ready", SessionID: session})
	if e := a.syncOnce(context.Background()); e == nil {
		t.Fatal("failed ACK not detected")
	}
	events, _ := pendingEvents(a.db)
	if len(events) != 1 {
		t.Fatal("event lost before ACK")
	}
	acknowledgeEvents = true
	if e := a.syncOnce(context.Background()); e != nil {
		t.Fatal(e)
	}
	events, _ = pendingEvents(a.db)
	if len(events) != 0 {
		t.Fatal("ACK did not drain queue")
	}
	server.Close()
	if e := a.syncOnce(context.Background()); e == nil {
		t.Fatal("offline undetected")
	}
	if a.current == nil || a.manifest == nil {
		t.Fatal("offline discarded prepared media")
	}
	p, _ := a.cache.path(m.Assets[0].SHA256)
	f, e := os.Open(p)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	got, _ := io.ReadAll(f)
	if string(got) != string(b) {
		t.Fatal("offline disk media unavailable")
	}
}
