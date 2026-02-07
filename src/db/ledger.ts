import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../data/gateway.db");

let db: Database.Database;

export function initDatabase(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      key TEXT NOT NULL,
      daily_usage INTEGER DEFAULT 0,
      daily_limit INTEGER DEFAULT 1000,
      last_reset TEXT,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      payer TEXT,
      network TEXT,
      amount TEXT,
      scheme TEXT,
      upstream_status INTEGER,
      latency_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_requests_service ON requests(service);
    CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_service ON api_keys(service, active);
  `);
}

export function logRequest(entry: {
  service: string;
  endpoint: string;
  payer?: string;
  network?: string;
  amount?: string;
  scheme?: string;
  upstreamStatus: number;
  latencyMs: number;
}): string {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO requests (id, service, endpoint, payer, network, amount, scheme, upstream_status, latency_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entry.service,
    entry.endpoint,
    entry.payer ?? null,
    entry.network ?? null,
    entry.amount ?? null,
    entry.scheme ?? null,
    entry.upstreamStatus,
    entry.latencyMs,
  );
  return id;
}

export function getApiKey(service: string): { id: string; key: string } | null {
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily counters if new day
  db.prepare(`
    UPDATE api_keys SET daily_usage = 0, last_reset = ?
    WHERE service = ? AND (last_reset IS NULL OR last_reset != ?)
  `).run(today, service, today);

  const row = db.prepare(`
    SELECT id, key FROM api_keys
    WHERE service = ? AND active = 1 AND daily_usage < daily_limit
    ORDER BY daily_usage ASC
    LIMIT 1
  `).get(service) as { id: string; key: string } | undefined;

  return row ?? null;
}

export function incrementKeyUsage(keyId: string): void {
  db.prepare(`UPDATE api_keys SET daily_usage = daily_usage + 1 WHERE id = ?`).run(keyId);
}

export function seedKeysFromEnv(service: string, keys: string[]): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO api_keys (id, service, key) VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const key of keys) {
      insert.run(`${service}:${key.slice(0, 8)}`, service, key);
    }
  });
  tx();
}

export function getStats(): {
  totalRequests: number;
  byService: Record<string, number>;
  last24h: number;
} {
  const total = db.prepare(`SELECT COUNT(*) as count FROM requests`).get() as { count: number };

  const byService = db.prepare(`
    SELECT service, COUNT(*) as count FROM requests GROUP BY service
  `).all() as { service: string; count: number }[];

  const last24h = db.prepare(`
    SELECT COUNT(*) as count FROM requests
    WHERE created_at > datetime('now', '-1 day')
  `).get() as { count: number };

  const serviceMap: Record<string, number> = {};
  for (const row of byService) {
    serviceMap[row.service] = row.count;
  }

  return {
    totalRequests: total.count,
    byService: serviceMap,
    last24h: last24h.count,
  };
}

export function getDb(): Database.Database {
  return db;
}
