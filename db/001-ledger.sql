PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ledger_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  anchor TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS ledger_rows (
  collection TEXT NOT NULL CHECK (collection IN
    ('observations','authority','reviews','audit','feeds','quarantine','reports','notifications')),
  id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_extract(payload, '$.id') IS id),
  PRIMARY KEY (collection, id)
) STRICT;
CREATE INDEX IF NOT EXISTS rows_by_topic
ON ledger_rows(collection, json_extract(payload, '$.topic'));

CREATE TRIGGER IF NOT EXISTS immutable_ledger_history
BEFORE UPDATE ON ledger_rows
WHEN OLD.collection IN ('observations', 'authority', 'audit', 'notifications')
BEGIN
  SELECT RAISE(ABORT, 'append-only ledger collection');
END;
