package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Cache struct {
	Dir    string
	Quota  int64
	Client *http.Client
	CMS    string
	Token  string
}

func (c *Cache) path(hash string) (string, error) {
	if !hashPattern.MatchString(hash) {
		return "", errors.New("invalid content hash")
	}
	return filepath.Join(c.Dir, hash), nil
}
func fileHash(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	_, err = io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), err
}
func (c *Cache) stats() (count int, total int64) {
	entries, _ := os.ReadDir(c.Dir)
	for _, e := range entries {
		if e.Type().IsRegular() && (hashPattern.MatchString(e.Name()) || hashPattern.MatchString(strings.TrimSuffix(e.Name(), ".part"))) {
			info, err := e.Info()
			if err == nil {
				total += info.Size()
				if hashPattern.MatchString(e.Name()) {
					count++
				}
			}
		}
	}
	return
}

// Eviction only touches agent-owned hash files. Published manifest hashes stay pinned.
func (c *Cache) reserve(extra int64, pinned map[string]bool, keep string) error {
	_, total := c.stats()
	if total+extra <= c.Quota {
		return nil
	}
	entries, _ := os.ReadDir(c.Dir)
	var candidates []os.FileInfo
	for _, e := range entries {
		base := strings.TrimSuffix(e.Name(), ".part")
		if e.Type().IsRegular() && hashPattern.MatchString(base) && !pinned[base] && base != keep {
			if info, err := e.Info(); err == nil {
				candidates = append(candidates, info)
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].ModTime().Before(candidates[j].ModTime()) })
	for _, f := range candidates {
		if total+extra <= c.Quota {
			break
		}
		if err := os.Remove(filepath.Join(c.Dir, f.Name())); err != nil {
			return err
		}
		total -= f.Size()
	}
	if total+extra > c.Quota {
		return errors.New("cache quota cannot fit current and staged media; old schedule retained")
	}
	return nil
}
func (c *Cache) fetch(ctx context.Context, a Asset, pinned map[string]bool) error {
	if a.Size <= 0 || a.Size > c.Quota {
		return errors.New("invalid asset size or asset exceeds cache quota")
	}
	file, err := c.path(a.SHA256)
	if err != nil {
		return err
	}
	if info, err := os.Lstat(file); err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("cache target is not a regular file")
		}
		if info.Size() == a.Size {
			if hash, err := fileHash(file); err == nil && hash == a.SHA256 {
				return nil
			}
		}
		if err = os.Remove(file); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	if err = os.MkdirAll(c.Dir, 0700); err != nil {
		return err
	}
	partial := file + ".part"
	var offset int64
	if info, err := os.Lstat(partial); err == nil {
		if !info.Mode().IsRegular() {
			return errors.New("partial cache path is not a regular file")
		}
		offset = info.Size()
	}
	if offset > a.Size {
		if err = os.Remove(partial); err != nil {
			return err
		}
		offset = 0
	}
	if offset == a.Size {
		return c.finish(partial, file, a)
	}
	if err = c.reserve(a.Size-offset, pinned, a.SHA256); err != nil {
		return err
	}
	base, _ := url.Parse(c.CMS + "/")
	relative, err := url.Parse(a.URL)
	if err != nil {
		return err
	}
	remote := base.ResolveReference(relative)
	if remote.User != nil || remote.Scheme != base.Scheme || remote.Host != base.Host {
		return errors.New("media must be on the configured CMS origin")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", remote.String(), nil)
	if err != nil {
		return err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	response, err := c.Client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	flags := os.O_CREATE | os.O_WRONLY
	switch response.StatusCode {
	case http.StatusOK:
		offset = 0
		flags |= os.O_TRUNC
	case http.StatusPartialContent:
		var start, end, total int64
		if _, err = fmt.Sscanf(response.Header.Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &total); err != nil || start != offset || end < start || end >= a.Size || total != a.Size {
			return errors.New("invalid resumed Content-Range")
		}
		flags |= os.O_APPEND
	default:
		return fmt.Errorf("media HTTP %d", response.StatusCode)
	}
	f, err := os.OpenFile(partial, flags, 0600)
	if err != nil {
		return err
	}
	// Never accept bytes above the declared manifest size.
	n, copyErr := io.Copy(f, io.LimitReader(response.Body, a.Size-offset+1))
	syncErr := f.Sync()
	closeErr := f.Close()
	if n > a.Size-offset {
		os.Remove(partial)
		return errors.New("media exceeded declared size")
	}
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	if closeErr != nil {
		return closeErr
	}
	if offset+n != a.Size {
		return errors.New("incomplete download; partial retained for next sync")
	}
	return c.finish(partial, file, a)
}
func (c *Cache) finish(partial, file string, a Asset) error {
	hash, err := fileHash(partial)
	if err != nil {
		return err
	}
	if hash != a.SHA256 {
		os.Remove(partial)
		return errors.New("SHA-256 mismatch; corrupted partial discarded")
	}
	// Windows cannot replace an existing file through Rename; only this verified hash target is affected.
	if _, err = os.Stat(file); err == nil {
		if err = os.Remove(file); err != nil {
			return err
		}
	}
	return os.Rename(partial, file)
}
func validateManifest(m Manifest, device string, quota int64) error {
	if m.DeviceID != device || m.Version < 1 || len(m.Playlists) < 1 || len(m.Playlists) > 100 || len(m.Assets) > 1000 {
		return errors.New("invalid manifest identity/size")
	}
	allowedTypes := map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true, "image/svg+xml": true, "video/webm": true, "video/mp4": true}
	assets := map[string]Asset{}
	for _, a := range m.Assets {
		if a.ID == "" || len(a.ID) > 100 || assets[a.ID].ID != "" || !allowedTypes[a.Type] || !hashPattern.MatchString(a.SHA256) || a.Size <= 0 {
			return errors.New("invalid/duplicate asset")
		}
		assets[a.ID] = a
	}
	used := map[string]bool{}
	playlists := map[string]bool{}
	var bytes int64
	for _, p := range m.Playlists {
		if p.ID == "" || playlists[p.ID] || len(p.Items) == 0 || len(p.Items) > 100 {
			return errors.New("invalid playlist")
		}
		playlists[p.ID] = true
		for _, i := range p.Items {
			a, ok := assets[i.AssetID]
			if !ok || !(i.Duration >= 2 && i.Duration <= 3600) {
				return errors.New("invalid playlist item")
			}
			if !used[a.SHA256] {
				if a.Size > quota-bytes {
					return errors.New("manifest media exceeds quota")
				}
				bytes += a.Size
				used[a.SHA256] = true
			}
		}
	}
	if !playlists[m.Schedule.PlaylistID] || !playlists[m.Schedule.FallbackID] {
		return errors.New("missing scheduled/fallback playlist")
	}
	for _, raw := range []*string{m.Schedule.StartsAt, m.Schedule.EndsAt} {
		if raw != nil {
			if _, err := parseDate(*raw); err != nil {
				return errors.New("invalid schedule date")
			}
		}
	}
	if m.Schedule.StartsAt != nil && m.Schedule.EndsAt != nil {
		s, _ := parseDate(*m.Schedule.StartsAt)
		e, _ := parseDate(*m.Schedule.EndsAt)
		if !e.After(s) {
			return errors.New("invalid schedule interval")
		}
	}
	return nil
}
