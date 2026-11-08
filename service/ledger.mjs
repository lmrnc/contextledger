import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const collections = new Set([
  'observations', 'authority', 'reviews', 'audit', 'feeds', 'quarantine', 'reports', 'notifications'
]);
const mutable = new Set(['reviews', 'feeds', 'quarantine', 'reports']);

export function openLedger(file) {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(new URL('../db/001-ledger.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT OR IGNORE INTO ledger_meta(singleton, anchor) VALUES (1, ?)').run(new Date().toISOString());
  const meta = db.prepare('SELECT revision, anchor FROM ledger_meta WHERE singleton = 1');
  const rows = db.prepare('SELECT collection, payload FROM ledger_rows ORDER BY rowid');
  const insert = db.prepare('INSERT INTO ledger_rows VALUES (?, ?, ?)');
  const upsert = db.prepare('INSERT INTO ledger_rows VALUES (?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET payload = excluded.payload');
  return {
    get anchor() { return meta.get().anchor; },
    snapshot() {
      const data = Object.fromEntries([...collections].map(name => [name, []]));
      for (const row of rows.iterate()) data[row.collection].push(JSON.parse(row.payload));
      return { revision: meta.get().revision, data };
    },
    commit(revision, writes) {
      if (!Number.isSafeInteger(revision) || !Array.isArray(writes) || writes.length > 5000) return false;
      db.exec('BEGIN IMMEDIATE');
      try {
        if (meta.get().revision !== revision) {
          db.exec('ROLLBACK');
          return false;
        }
        for (const { collection, row } of writes) {
          if (!collections.has(collection) || typeof row?.id !== 'string' || !row.id || row.id.length > 200) {
            throw new Error('Invalid ledger write');
          }
          const statement = mutable.has(collection) ? upsert : insert;
          statement.run(collection, row.id, JSON.stringify(row));
        }
        if (writes.length) db.exec('UPDATE ledger_meta SET revision = revision + 1 WHERE singleton = 1');
        db.exec('COMMIT');
        return true;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
