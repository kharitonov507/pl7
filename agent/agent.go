package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const version = "0.2.0"

type Agent struct {
	cfg               Config
	db                *sql.DB
	lockFile          *os.File
	cache             *Cache
	client            *http.Client
	token             string
	mu                sync.Mutex
	rendererWG        sync.WaitGroup
	manifest          *Manifest
	current           *Playback
	playlistID        string
	playlistName      string
	pointer           int
	paused            bool
	online            bool
	lastCommand       int64
	problem           string
	started           time.Time
	lastTick          time.Time
	lastAlive         time.Time
	lastCheckpoint    time.Time
	rendererConnected bool
	rendererVisible   bool
	mqttConnected     bool
	commands          chan IncomingCommand
}
type IncomingCommand struct {
	ID     string `json:"commandId"`
	Action string `json:"action"`
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func newAgent(c Config) (*Agent, error) {
	lock, err := acquireDataLock(c.DataDir)
	if err != nil {
		return nil, err
	}
	success := false
	defer func() {
		if !success {
			lock.Close()
		}
	}()
	db, err := openDB(c.DataDir)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || req.URL.Scheme != via[0].URL.Scheme || req.URL.Host != via[0].URL.Host {
			return errors.New("cross-origin or excessive redirect refused")
		}
		return nil
	}}
	a := &Agent{cfg: c, db: db, lockFile: lock, client: client, started: time.Now(), lastTick: time.Now(), commands: make(chan IncomingCommand, 32)}
	a.cache = &Cache{Dir: filepath.Join(c.DataDir, "cache"), Quota: c.CacheBytes, Client: client, CMS: c.CMS}
	if err = readMeta(db, "bridge-token", &a.token); err != nil {
		db.Close()
		return nil, err
	}
	if a.token == "" {
		a.token = newID() + newID()
		if err = writeMeta(db, "bridge-token", a.token); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err = readMeta(db, "manifest", &a.manifest); err != nil {
		db.Close()
		return nil, err
	}
	if err = readMeta(db, "command", &a.lastCommand); err != nil {
		db.Close()
		return nil, err
	}
	if err = readMeta(db, "paused", &a.paused); err != nil {
		db.Close()
		return nil, err
	}
	var abandoned *Playback
	if err = readMeta(db, "active", &abandoned); err != nil {
		db.Close()
		return nil, err
	}
	if abandoned != nil && abandoned.Started {
		if err = a.eventFor(abandoned, "interrupted", "Agent restarted; last checkpoint, not exact crash time"); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err = writeMeta(db, "active", nil); err != nil {
		db.Close()
		return nil, err
	}
	if a.manifest != nil {
		if err = validateManifest(*a.manifest, c.DeviceID, c.CacheBytes); err != nil {
			db.Close()
			return nil, err
		}
		// A deleted or corrupted disk cache cannot be presented as ready.
		for _, asset := range neededAssets(*a.manifest) {
			p, _ := a.cache.path(asset.SHA256)
			hash, err := fileHash(p)
			if err != nil || hash != asset.SHA256 {
				a.manifest = nil
				a.problem = "Saved media missing/corrupt; waiting for successful sync"
				break
			}
		}
	}
	a.selectPlaylist(time.Now())
	success = true
	return a, nil
}
func (a *Agent) close()                       { a.db.Close(); a.lockFile.Close() }
func parseDate(raw string) (time.Time, error) { return time.Parse(time.RFC3339Nano, raw) }
func neededAssets(m Manifest) []Asset {
	used := map[string]bool{}
	for _, p := range m.Playlists {
		for _, i := range p.Items {
			used[i.AssetID] = true
		}
	}
	out := []Asset{}
	for _, asset := range m.Assets {
		if used[asset.ID] {
			out = append(out, asset)
		}
	}
	return out
}
func (a *Agent) eventFor(p *Playback, kind, detail string) error {
	return writeEvent(a.db, Event{EventID: p.SessionID + "-" + kind, SessionID: p.SessionID, AssetID: p.Asset.ID, Kind: kind, OccurredAt: nowISO(), PlayedMS: p.PlayedMS, Detail: detail})
}
func (a *Agent) finish(kind, detail string) error {
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if a.current != nil && (a.current.Started || kind == "failed") {
		p := a.current
		b, err := json.Marshal(Event{EventID: p.SessionID + "-" + kind, SessionID: p.SessionID, AssetID: p.Asset.ID, Kind: kind, OccurredAt: nowISO(), PlayedMS: p.PlayedMS, Detail: detail})
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT OR IGNORE INTO events(event_id,body) VALUES(?,?)", p.SessionID+"-"+kind, string(b)); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("INSERT INTO meta(key,value) VALUES('active','null') ON CONFLICT(key) DO UPDATE SET value=excluded.value"); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	a.current = nil
	return nil
}
func (a *Agent) selectPlaylist(now time.Time) {
	if a.manifest == nil {
		return
	}
	s := a.manifest.Schedule
	inside := true
	if s.StartsAt != nil {
		t, _ := parseDate(*s.StartsAt)
		inside = inside && !now.Before(t)
	}
	if s.EndsAt != nil {
		t, _ := parseDate(*s.EndsAt)
		inside = inside && now.Before(t)
	}
	id := s.FallbackID
	if inside {
		id = s.PlaylistID
	}
	if id != a.playlistID {
		if err := a.finish("interrupted", "Local schedule boundary"); err != nil {
			a.problem = err.Error()
			return
		}
		a.playlistID = id
		a.pointer = 0
	}
	for _, p := range a.manifest.Playlists {
		if p.ID == id {
			a.playlistName = p.Name
			if a.current == nil {
				item := p.Items[a.pointer%len(p.Items)]
				a.pointer++
				for _, asset := range a.manifest.Assets {
					if asset.ID == item.AssetID {
						a.current = &Playback{SessionID: newID(), Asset: asset, DurationMS: int64(item.Duration * 1000)}
						break
					}
				}
			}
			break
		}
	}
}
func (a *Agent) rendererHealthy(now time.Time) bool {
	return a.rendererConnected && a.rendererVisible && now.Sub(a.lastAlive) < 2*time.Second
}
func (a *Agent) tick(now time.Time) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delta := now.Sub(a.lastTick)
	a.lastTick = now
	a.selectPlaylist(now)
	if a.current != nil && a.current.Started && !a.paused && a.rendererHealthy(now) && delta < 2*time.Second {
		if len(a.current.Asset.Type) >= 6 && a.current.Asset.Type[:6] == "image/" {
			a.current.PlayedMS += delta.Milliseconds()
		}
		if a.current.PlayedMS >= a.current.DurationMS {
			if err := a.finish("completed", "Scheduled interval elapsed; not necessarily full source video"); err != nil {
				a.problem = err.Error()
			}
			a.selectPlaylist(now)
		}
	}
	if a.current != nil && a.current.Started && now.Sub(a.lastCheckpoint) >= time.Second {
		a.current.CheckpointAt = now.UTC().Format(time.RFC3339Nano)
		if err := writeMeta(a.db, "active", a.current); err != nil {
			a.problem = err.Error()
		} else {
			a.lastCheckpoint = now
		}
	}
}

type Report struct {
	SessionID string  `json:"sessionId"`
	Kind      string  `json:"kind"`
	PlayedMS  float64 `json:"playedMs"`
	Detail    string  `json:"detail"`
	Visible   bool    `json:"visible"`
}

func (a *Agent) report(r Report) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if r.Kind == "alive" {
		a.lastAlive = time.Now()
		a.rendererVisible = r.Visible
		return nil
	}
	if a.current == nil || r.SessionID != a.current.SessionID {
		return errors.New("stale playback session")
	}
	p := a.current
	if math.IsNaN(r.PlayedMS) || math.IsInf(r.PlayedMS, 0) || r.PlayedMS < 0 || r.PlayedMS > 86400000 {
		return errors.New("invalid playback position")
	}
	switch r.Kind {
	case "ready":
		if !p.Started {
			// Start event and recovery checkpoint must survive together.
			next := *p
			next.Started = true
			next.CheckpointAt = nowISO()
			b, err := json.Marshal(next)
			if err != nil {
				return err
			}
			event, _ := json.Marshal(Event{EventID: p.SessionID + "-started", SessionID: p.SessionID, AssetID: p.Asset.ID, Kind: "started", OccurredAt: next.CheckpointAt})
			tx, err := a.db.Begin()
			if err != nil {
				return err
			}
			defer tx.Rollback()
			if _, err = tx.Exec("INSERT OR IGNORE INTO events(event_id,body) VALUES(?,?)", p.SessionID+"-started", string(event)); err != nil {
				return err
			}
			if _, err = tx.Exec("INSERT INTO meta(key,value) VALUES('active',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(b)); err != nil {
				return err
			}
			if err = tx.Commit(); err != nil {
				return err
			}
			*p = next
			a.lastTick = time.Now()
			return nil
		}
	case "progress", "ended":
		if r.Kind == "ended" && !strings.HasPrefix(p.Asset.Type, "video/") {
			return errors.New("ended requires a video asset")
		}
		if p.Started && !a.paused && a.rendererVisible && p.Asset.Type[:6] == "video/" {
			p.PlayedMS = int64(r.PlayedMS)
		}
		if r.Kind == "ended" {
			if !p.Started {
				return errors.New("video ended before ready")
			}
			if err := a.finish("completed", "Video reached ended; player-reported position"); err != nil {
				return err
			}
			a.selectPlaylist(time.Now())
			return nil
		}
	case "failed":
		if err := a.finish("failed", r.Detail); err != nil {
			return err
		}
		a.selectPlaylist(time.Now())
		return nil
	default:
		return errors.New("unknown renderer report")
	}
	p.CheckpointAt = nowISO()
	return writeMeta(a.db, "active", p)
}
func (a *Agent) applyCommand(c IncomingCommand) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if c.ID == "" || len(c.ID) > 100 {
		return errors.New("command ID required")
	}
	if c.Action != "pause" && c.Action != "resume" && c.Action != "next" && c.Action != "restart" {
		return errors.New("unsupported command")
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var found int
	if err := tx.QueryRow("SELECT count(*) FROM commands WHERE command_id=?", c.ID).Scan(&found); err != nil {
		return err
	}
	if found > 0 {
		return nil
	}
	switch c.Action {
	case "pause", "resume":
		b, _ := json.Marshal(c.Action == "pause")
		_, err = tx.Exec("INSERT INTO meta(key,value) VALUES('paused',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(b))
	case "next", "restart":
		if p := a.current; p != nil && p.Started {
			e := Event{EventID: p.SessionID + "-interrupted", SessionID: p.SessionID, AssetID: p.Asset.ID, Kind: "interrupted", OccurredAt: nowISO(), PlayedMS: p.PlayedMS, Detail: "Command: " + c.Action}
			b, marshalErr := json.Marshal(e)
			if marshalErr != nil {
				return marshalErr
			}
			_, err = tx.Exec("INSERT OR IGNORE INTO events(event_id,body) VALUES(?,?)", e.EventID, string(b))
		}
		if err == nil {
			_, err = tx.Exec("INSERT INTO meta(key,value) VALUES('active','null') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
		}
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO commands VALUES(?,?)", c.ID, nowISO()); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if c.Action == "pause" || c.Action == "resume" {
		a.paused = c.Action == "pause"
	} else {
		a.current = nil
		a.selectPlaylist(time.Now())
	}
	return nil
}
func (a *Agent) snapshot() State {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := State{DeviceID: a.cfg.DeviceID, Backend: "Go + SQLite WAL + disk cache", Online: a.online, Paused: a.paused, QuotaBytes: a.cfg.CacheBytes, PlaylistName: a.playlistName, Error: a.problem, RendererConnected: a.rendererConnected, RendererHealthy: a.rendererHealthy(time.Now()), MQTTConnected: a.mqttConnected, UptimeSeconds: int64(time.Since(a.started).Seconds())}
	if a.manifest != nil {
		s.Name = a.manifest.Name
		s.Version = a.manifest.Version
	}
	if a.current != nil {
		p := *a.current
		s.Current = &p
	}
	if err := a.db.QueryRow("SELECT count(*) FROM events").Scan(&s.Queue); err != nil {
		s.Error = "Queue database unavailable: " + err.Error()
	}
	s.CacheCount, s.CacheBytes = a.cache.stats()
	return s
}
func (a *Agent) cmsRequest(ctx context.Context, method, path string, input, out any) error {
	var body io.Reader
	if input != nil {
		b, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.cfg.CMS+"/api/devices/"+a.cfg.DeviceID+path, body)
	if err != nil {
		return err
	}
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if a.cache.Token != "" {
		req.Header.Set("Authorization", "Bearer "+a.cache.Token)
	}
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("CMS HTTP %d", res.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(out)
	}
	return nil
}
func (a *Agent) syncOnce(ctx context.Context) error {
	var next Manifest
	if err := a.cmsRequest(ctx, "GET", "/manifest", nil, &next); err != nil {
		return err
	}
	if err := validateManifest(next, a.cfg.DeviceID, a.cfg.CacheBytes); err != nil {
		return err
	}
	a.mu.Lock()
	changed := a.manifest == nil || a.manifest.Version != next.Version
	pinned := map[string]bool{}
	if a.manifest != nil {
		for _, asset := range neededAssets(*a.manifest) {
			pinned[asset.SHA256] = true
		}
	}
	a.mu.Unlock()
	if changed {
		for _, asset := range neededAssets(next) {
			if err := a.cache.fetch(ctx, asset, pinned); err != nil {
				return err
			}
			pinned[asset.SHA256] = true
		}
		a.mu.Lock()
		// Persist prepared manifest before publishing it to the renderer.
		err := writeMeta(a.db, "manifest", next)
		if err == nil {
			err = a.finish("interrupted", "New prepared manifest")
		}
		if err == nil {
			a.manifest = &next
			a.playlistID = ""
			a.pointer = 0
			a.selectPlaylist(time.Now())
		}
		a.mu.Unlock()
		if err != nil {
			return err
		}
	}
	a.mu.Lock()
	last := a.lastCommand
	a.mu.Unlock()
	if next.Command.Seq > last {
		if err := a.applyCommand(IncomingCommand{ID: fmt.Sprintf("cms-%d", next.Command.Seq), Action: next.Command.Action}); err != nil {
			return err
		}
		if err := writeMeta(a.db, "command", next.Command.Seq); err != nil {
			return err
		}
		a.mu.Lock()
		a.lastCommand = next.Command.Seq
		a.mu.Unlock()
	}
	events, err := pendingEvents(a.db)
	if err != nil {
		return err
	}
	if len(events) > 0 {
		var ack struct {
			IDs []string `json:"acknowledged"`
		}
		if err = a.cmsRequest(ctx, "POST", "/events", map[string]any{"events": events}, &ack); err != nil {
			return err
		}
		if err = acknowledge(a.db, events, ack.IDs); err != nil {
			return err
		}
	}
	s := a.snapshot()
	heartbeat := map[string]any{"paused": s.Paused, "queue": s.Queue, "cacheCount": s.CacheCount, "playlistName": s.PlaylistName, "error": s.Error}
	if s.Current != nil {
		heartbeat["assetId"] = s.Current.Asset.ID
		heartbeat["assetName"] = s.Current.Asset.Name
	}
	return a.cmsRequest(ctx, "POST", "/heartbeat", heartbeat, nil)
}
func (a *Agent) syncLoop(ctx context.Context) {
	for {
		err := a.syncOnce(ctx)
		a.mu.Lock()
		a.online = err == nil
		if err != nil {
			a.problem = err.Error()
		} else {
			a.problem = ""
		}
		a.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(a.cfg.PollSeconds) * time.Second):
		}
	}
}
