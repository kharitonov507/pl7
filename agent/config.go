package main

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

type Config struct {
	DeviceID               string   `json:"deviceId"`
	CMS                    string   `json:"cms"`
	Listen                 string   `json:"listen"`
	DataDir                string   `json:"dataDir"`
	CacheBytes             int64    `json:"cacheBytes"`
	PollSeconds            int      `json:"pollSeconds"`
	Chromium               string   `json:"chromium"`
	ChromiumArgs           []string `json:"chromiumArgs"`
	RendererTimeoutSeconds int      `json:"rendererTimeoutSeconds"`
	MQTTBroker             string   `json:"mqttBroker"`
	MQTTCA                 string   `json:"mqttCA"`
	MQTTTopic              string   `json:"mqttTopic"`
	OTAPublicKey           string   `json:"otaPublicKey"`
}

var devicePattern = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

func loadConfig(file string) (Config, error) {
	c := Config{DeviceID: "screen-02", CMS: "http://127.0.0.1:8787", Listen: "127.0.0.1:8791", DataDir: "data/screen-02", CacheBytes: 512 << 20, PollSeconds: 2, RendererTimeoutSeconds: 30}
	b, err := os.ReadFile(file)
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	if !devicePattern.MatchString(c.DeviceID) || c.CacheBytes < 1024 || c.PollSeconds < 1 || c.RendererTimeoutSeconds < 5 {
		return c, errors.New("invalid device/quota/timing configuration")
	}
	host, _, err := net.SplitHostPort(c.Listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return c, errors.New("bridge must listen on a loopback IP")
	}
	if err = validateRemote(c.CMS); err != nil {
		return c, err
	}
	c.CMSURLTrim()
	c.DataDir, err = filepath.Abs(c.DataDir)
	return c, err
}
func (c *Config) CMSURLTrim() {
	for len(c.CMS) > 0 && c.CMS[len(c.CMS)-1] == '/' {
		c.CMS = c.CMS[:len(c.CMS)-1]
	}
}
func validateRemote(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("invalid server URL")
	}
	if u.Scheme == "https" {
		return nil
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme == "http" && (u.Hostname() == "localhost" || ip != nil && ip.IsLoopback()) {
		return nil
	}
	return errors.New("non-local server requires HTTPS")
}
func nowISO() string { return time.Now().UTC().Format(time.RFC3339Nano) }

type Asset struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	URL    string `json:"url"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type Item struct {
	AssetID  string  `json:"assetId"`
	Duration float64 `json:"duration"`
}
type Playlist struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Items []Item `json:"items"`
}
type Schedule struct {
	PlaylistID string  `json:"playlistId"`
	FallbackID string  `json:"fallbackId"`
	StartsAt   *string `json:"startsAt"`
	EndsAt     *string `json:"endsAt"`
}
type Command struct {
	Seq    int64  `json:"seq"`
	Action string `json:"action"`
}
type Manifest struct {
	DeviceID  string     `json:"deviceId"`
	Name      string     `json:"name"`
	Version   int64      `json:"version"`
	Schedule  Schedule   `json:"schedule"`
	Assets    []Asset    `json:"assets"`
	Playlists []Playlist `json:"playlists"`
	Command   Command    `json:"command"`
}
type Event struct {
	EventID    string `json:"eventId"`
	SessionID  string `json:"sessionId"`
	AssetID    string `json:"assetId"`
	Kind       string `json:"kind"`
	OccurredAt string `json:"occurredAt"`
	PlayedMS   int64  `json:"playedMs"`
	Detail     string `json:"detail"`
}
type Playback struct {
	SessionID    string `json:"sessionId"`
	Asset        Asset  `json:"asset"`
	DurationMS   int64  `json:"durationMs"`
	PlayedMS     int64  `json:"playedMs"`
	Started      bool   `json:"started"`
	CheckpointAt string `json:"checkpointAt,omitempty"`
}
type State struct {
	DeviceID          string    `json:"deviceId"`
	Name              string    `json:"name"`
	Backend           string    `json:"backend"`
	Online            bool      `json:"online"`
	Paused            bool      `json:"paused"`
	Queue             int       `json:"queue"`
	CacheCount        int       `json:"cacheCount"`
	CacheBytes        int64     `json:"cacheBytes"`
	QuotaBytes        int64     `json:"quotaBytes"`
	PlaylistName      string    `json:"playlistName"`
	Version           int64     `json:"version"`
	Current           *Playback `json:"current"`
	Error             string    `json:"error"`
	RendererConnected bool      `json:"rendererConnected"`
	RendererHealthy   bool      `json:"rendererHealthy"`
	MQTTConnected     bool      `json:"mqttConnected"`
	UptimeSeconds     int64     `json:"uptimeSeconds"`
}
