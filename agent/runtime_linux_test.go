package main

import (
	"net"
	"path/filepath"
	"testing"
	"time"
)

func TestSystemdNotifySocket(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notify.sock")
	conn, e := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: path, Net: "unixgram"})
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	t.Setenv("NOTIFY_SOCKET", path)
	if e = notifySystemd("READY=1\nWATCHDOG=1"); e != nil {
		t.Fatal(e)
	}
	conn.SetReadDeadline(time.Now().Add(time.Second))
	b := make([]byte, 256)
	n, _, e := conn.ReadFromUnix(b)
	if e != nil || string(b[:n]) != "READY=1\nWATCHDOG=1" {
		t.Fatal(string(b[:n]), e)
	}
}
