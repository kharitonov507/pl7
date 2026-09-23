package main

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
)

// Signature covers the exact payload bytes, not re-serialized JSON.
type UpdatePayload struct {
	Version  string `json:"version"`
	Sequence int64  `json:"sequence"`
	OS       string `json:"os"`
	Arch     string `json:"arch"`
	URL      string `json:"url"`
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
}
type UpdateEnvelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}

func verifyUpdate(b []byte, key string) (UpdatePayload, error) {
	var p UpdatePayload
	public, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(public) != ed25519.PublicKeySize {
		return p, errors.New("OTA requires pinned Ed25519 public key")
	}
	var e UpdateEnvelope
	if err = json.Unmarshal(b, &e); err != nil {
		return p, err
	}
	raw, err := base64.StdEncoding.DecodeString(e.Payload)
	if err != nil {
		return p, err
	}
	signature, err := base64.StdEncoding.DecodeString(e.Signature)
	if err != nil || !ed25519.Verify(public, raw, signature) {
		return p, errors.New("invalid update signature")
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		return p, err
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9._-]{1,64}$`).MatchString(p.Version) || p.Sequence < 1 || p.OS != runtime.GOOS || p.Arch != runtime.GOARCH || !hashPattern.MatchString(p.SHA256) || p.Size < 1 || p.Size > 100<<20 {
		return p, errors.New("invalid update version/platform/size")
	}
	if err = validateRemote(p.URL); err != nil {
		return p, err
	}
	return p, nil
}
func (a *Agent) stageOTA(ctx context.Context, file string) error {
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	if len(b) > 16384 {
		return errors.New("update manifest too large")
	}
	p, err := verifyUpdate(b, a.cfg.OTAPublicKey)
	if err != nil {
		return err
	}
	var sequence int64
	if err = readMeta(a.db, "ota-sequence", &sequence); err != nil {
		return err
	}
	if p.Sequence <= sequence {
		return errors.New("update replay/downgrade refused")
	}
	directory := filepath.Join(a.cfg.DataDir, "updates")
	if err = os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	partial := filepath.Join(directory, p.SHA256+".part")
	target := filepath.Join(directory, p.SHA256+".candidate")
	req, err := http.NewRequestWithContext(ctx, "GET", p.URL, nil)
	if err != nil {
		return err
	}
	response, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("update HTTP %d", response.StatusCode)
	}
	f, err := os.OpenFile(partial, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, copyErr := io.Copy(f, io.LimitReader(response.Body, p.Size+1))
	syncErr := f.Sync()
	closeErr := f.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != p.Size {
		os.Remove(partial)
		return errors.New("update size mismatch")
	}
	hash, err := fileHash(partial)
	if err != nil {
		return err
	}
	if hash != p.SHA256 {
		os.Remove(partial)
		return errors.New("update SHA-256 mismatch")
	}
	if err = os.Rename(partial, target); err != nil {
		return err
	}
	tx, err := a.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	metadata, _ := json.Marshal(p)
	if _, err = tx.Exec("INSERT INTO meta(key,value) VALUES('ota-candidate',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", string(metadata)); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO meta(key,value) VALUES('ota-sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", fmt.Sprint(p.Sequence)); err != nil {
		return err
	}
	return tx.Commit()
	// Deliberately no executable replacement, privilege escalation or restart here.
}
