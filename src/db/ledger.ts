import pg from "pg";
import { v4 as uuidv4 } from "uuid";

const { Pool } = pg;

let pool: pg.Pool;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export async function initDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: 50,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.PG_SSL_REJECT_UNAUTHORIZED === "false"
      ? { rejectUnauthorized: false }
      : databaseUrl.includes("railway.internal")
        ? { rejectUnauthorized: false }
        : undefined,
  });

  // Log pool errors instead of crashing
  pool.on("error", (err) => {
    console.error("PG pool background error:", err.message);
  });

  // Test connection and create tables
  const client = await pool.connect();
  try {
    await client.query(`
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
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS used_tx_hashes (
        tx_hash TEXT PRIMARY KEY,
        payer TEXT,
        amount TEXT,
        network TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_requests_service ON requests(service);
      CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
      CREATE INDEX IF NOT EXISTS idx_requests_payer ON requests(payer);
      CREATE INDEX IF NOT EXISTS idx_used_tx_created ON used_tx_hashes(created_at);
    `);
  } finally {
    client.release();
  }

  // Start batched log flusher
  startLogFlusher();

  // Start daily cleanup timer (every 24 hours)
  cleanupTimer = setInterval(async () => {
    try {
      const deleted = await cleanupOldRequests(90);
      if (deleted > 0) {
        console.log(`  DB cleanup: removed ${deleted} request logs older than 90 days`);
      }
    } catch (err: any) {
      console.error("DB cleanup failed:", err.message);
    }
  }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref(); // Don't prevent process exit
}

// --- Batched request logging ---
// Buffers INSERTs and flushes every 2 seconds or when batch hits 50 entries.
// Reduces DB connections used under load from 1-per-request to 1-per-flush.

interface LogEntry {
  id: string;
  service: string;
  endpoint: string;
  payer: string | null;
  network: string | null;
  amount: string | null;
  scheme: string | null;
  upstreamStatus: number;
  latencyMs: number;
}

const LOG_BATCH_SIZE = 50;
const LOG_FLUSH_INTERVAL_MS = 2_000;
let logBuffer: LogEntry[] = [];
let logFlushTimer: ReturnType<typeof setInterval> | null = null;

function startLogFlusher(): void {
  if (logFlushTimer) return;
  logFlushTimer = setInterval(flushLogBuffer, LOG_FLUSH_INTERVAL_MS);
  logFlushTimer.unref();
}

async function flushLogBuffer(): Promise<void> {
  if (logBuffer.length === 0) return;
  const batch = logBuffer;
  logBuffer = [];

  // Build a multi-row INSERT
  const values: any[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < batch.length; i++) {
    const e = batch[i];
    const offset = i * 9;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`,
    );
    values.push(e.id, e.service, e.endpoint, e.payer, e.network, e.amount, e.scheme, e.upstreamStatus, e.latencyMs);
  }

  try {
    await pool.query(
      `INSERT INTO requests (id, service, endpoint, payer, network, amount, scheme, upstream_status, latency_ms)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  } catch (err: any) {
    console.error(`Failed to flush ${batch.length} log entries:`, err.message);
  }
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
}): void {
  logBuffer.push({
    id: uuidv4(),
    service: entry.service,
    endpoint: entry.endpoint,
    payer: entry.payer ?? null,
    network: entry.network ?? null,
    amount: entry.amount ?? null,
    scheme: entry.scheme ?? null,
    upstreamStatus: entry.upstreamStatus,
    latencyMs: entry.latencyMs,
  });

  // Flush immediately if batch is full
  if (logBuffer.length >= LOG_BATCH_SIZE) {
    flushLogBuffer();
  }
}

/**
 * Atomically record a tx hash. Returns true if inserted (first use),
 * false if it already existed (replay attempt).
 */
export async function recordTxHash(
  txHash: string,
  payer?: string,
  amount?: string,
  network?: string,
): Promise<boolean> {
  try {
    const result = await pool.query(
      `INSERT INTO used_tx_hashes (tx_hash, payer, amount, network)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tx_hash) DO NOTHING`,
      [txHash.toLowerCase(), payer ?? null, amount ?? null, network ?? null],
    );
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a tx hash has been used before.
 */
export async function isTxHashUsed(txHash: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM used_tx_hashes WHERE tx_hash = $1`,
    [txHash.toLowerCase()],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Lightweight stats using approximate counts where possible.
 * Uses pg_class reltuples for total count (fast estimate),
 * and a time-bounded query for last 24h (uses created_at index).
 */
export async function getStats(): Promise<{
  totalRequests: number;
  byService: Record<string, number>;
  last24h: number;
  usedTxHashes: number;
}> {
  const [approxTotal, byService, last24h, approxTx] = await Promise.all([
    // Fast approximate count via pg_class stats (no table scan)
    pool.query(`SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'requests'`),
    // GROUP BY uses the idx_requests_service index
    pool.query(`SELECT service, COUNT(*)::int as count FROM requests GROUP BY service`),
    // Uses idx_requests_created index (bounded scan)
    pool.query(`SELECT COUNT(*)::int as count FROM requests WHERE created_at > NOW() - INTERVAL '1 day'`),
    // Fast approximate count for tx hashes
    pool.query(`SELECT reltuples::bigint AS count FROM pg_class WHERE relname = 'used_tx_hashes'`),
  ]);

  const serviceMap: Record<string, number> = {};
  for (const row of byService.rows) {
    serviceMap[row.service] = row.count;
  }

  return {
    totalRequests: Math.max(0, Number(approxTotal.rows[0]?.count ?? 0)),
    byService: serviceMap,
    last24h: last24h.rows[0].count,
    usedTxHashes: Math.max(0, Number(approxTx.rows[0]?.count ?? 0)),
  };
}

/**
 * Clean up old request logs (retention policy).
 */
export async function cleanupOldRequests(daysToKeep = 90): Promise<number> {
  const result = await pool.query(
    `DELETE FROM requests WHERE created_at < NOW() - $1 * INTERVAL '1 day'`,
    [daysToKeep],
  );
  return result.rowCount ?? 0;
}

/**
 * Check if the database connection is alive.
 */
export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get pool utilization info.
 */
export function getPoolStats(): { total: number; idle: number; waiting: number } {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

/**
 * Gracefully drain the pool and stop cleanup timer.
 */
export async function shutdownDatabase(): Promise<void> {
  if (logFlushTimer) {
    clearInterval(logFlushTimer);
    logFlushTimer = null;
  }
  // Flush any remaining buffered logs
  await flushLogBuffer();

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  await pool.end();
}

export function getPool(): pg.Pool {
  return pool;
}
