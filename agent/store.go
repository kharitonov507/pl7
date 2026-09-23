package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
)

func openDB(dir string) (*sql.DB, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "agent.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(event_id TEXT PRIMARY KEY,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS commands(command_id TEXT PRIMARY KEY,received_at TEXT NOT NULL);
 PRAGMA optimize;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
func readMeta(db *sql.DB, key string, out any) error {
	var b string
	err := db.QueryRow("SELECT value FROM meta WHERE key=?", key).Scan(&b)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(b), out)
}
func writeMeta(db *sql.DB, key string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, string(b))
	return err
}
func writeEvent(db *sql.DB, e Event) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	_, err = db.Exec("INSERT OR IGNORE INTO events VALUES(?,?)", e.EventID, string(b))
	return err
}
func pendingEvents(db *sql.DB) ([]Event, error) {
	rows, err := db.Query("SELECT body FROM events ORDER BY rowid LIMIT 500")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Event{}
	for rows.Next() {
		var b string
		var e Event
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(b), &e); err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}
func acknowledge(db *sql.DB, events []Event, ids []string) error {
	allowed := map[string]bool{}
	for _, e := range events {
		allowed[e.EventID] = true
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, id := range ids {
		if allowed[id] {
			if _, err = tx.Exec("DELETE FROM events WHERE event_id=?", id); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
