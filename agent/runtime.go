package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func validateListen(address string) error {
	host, _, err := net.SplitHostPort(address)
	ip := net.ParseIP(host)
	if err != nil || ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("bridge requires loopback address")
	}
	return nil
}
func notifySystemd(message string) error {
	socket := os.Getenv("NOTIFY_SOCKET")
	if runtime.GOOS != "linux" || socket == "" {
		return nil
	}
	if strings.HasPrefix(socket, "@") {
		socket = "\x00" + socket[1:]
	}
	conn, err := net.DialTimeout("unixgram", socket, time.Second)
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetWriteDeadline(time.Now().Add(time.Second))
	_, err = conn.Write([]byte(message))
	return err
}
func watchdogInterval() time.Duration {
	usec, _ := strconv.ParseInt(os.Getenv("WATCHDOG_USEC"), 10, 64)
	if usec >= 2000 && usec <= 60000000 {
		return time.Duration(usec) * time.Microsecond / 2
	}
	return 10 * time.Second
}
func (a *Agent) supervise(ctx context.Context) {
	if a.cfg.Chromium == "" {
		return
	}
	delay := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		args := []string{"--kiosk", "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + filepath.Join(a.cfg.DataDir, "browser-profile")}
		args = append(args, a.cfg.ChromiumArgs...)
		args = append(args, "http://"+a.cfg.Listen+"/?kiosk=1")
		browserCtx, kill := context.WithCancel(ctx)
		cmd := exec.CommandContext(browserCtx, a.cfg.Chromium, args...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		started := time.Now()
		err := cmd.Start()
		if err == nil {
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			watch := time.NewTicker(time.Second)
			running := true
			for running {
				select {
				case <-ctx.Done():
					kill()
					<-done
					watch.Stop()
					return
				case err = <-done:
					running = false
				case <-watch.C:
					a.mu.Lock()
					alive := a.lastAlive
					connected := a.rendererConnected
					a.mu.Unlock()
					limit := time.Duration(a.cfg.RendererTimeoutSeconds) * time.Second
					if time.Since(started) > limit && (!connected || time.Since(alive) > limit) {
						log.Print("Renderer watchdog: restarting owned Chromium process")
						kill()
					}
				}
			}
			watch.Stop()
		}
		kill()
		log.Printf("Chromium exited: %v", err)
		a.mu.Lock()
		if finishErr := a.finish("interrupted", "Chromium exited/watchdog restart"); finishErr != nil {
			a.problem = finishErr.Error()
		}
		a.selectPlaylist(time.Now())
		a.mu.Unlock()
		if time.Since(started) > time.Minute {
			delay = time.Second
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		if delay < 30*time.Second {
			delay *= 2
		}
	}
}
