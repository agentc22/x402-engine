import { Router, type Request, type Response } from "express";
import { getPool } from "../db/ledger.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

// Cache health data for 60 seconds to avoid hammering DB
const cache = new TTLCache<ServiceHealthResponse>(60_000);
const CACHE_KEY = "service-health";

interface ServiceHealth {
  status: "healthy" | "degraded" | "down";
  latency: { p50: number | null; p95: number | null; p99: number | null };
  error_rate: number | null;
  requests_24h: number;
  last_called: string | null;
}

interface NetworkHealth {
  status: "healthy" | "degraded" | "down";
  requests_24h: number;
}

interface ServiceHealthResponse {
  timestamp: string;
  services: Record<string, ServiceHealth>;
  networks: Record<string, NetworkHealth>;
}

const HEALTH_QUERY = `
SELECT
  service,
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int AS last_24h,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS p99,
  COUNT(*) FILTER (WHERE upstream_status >= 400 AND created_at > NOW() - INTERVAL '1 day')::float
    / NULLIF(COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day'), 0) AS error_rate,
  MAX(created_at) AS last_called
FROM requests
WHERE service != 'megaeth-payment'
GROUP BY service;
`;

const NETWORK_QUERY = `
SELECT
  network,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int AS last_24h,
  COUNT(*) FILTER (WHERE upstream_status >= 400 AND created_at > NOW() - INTERVAL '1 day')::float
    / NULLIF(COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day'), 0) AS error_rate
FROM requests
WHERE network IS NOT NULL
GROUP BY network;
`;

function statusFromErrorRate(errorRate: number | null): "healthy" | "degraded" | "down" {
  if (errorRate === null) return "healthy";
  if (errorRate > 0.5) return "down";
  if (errorRate > 0.1) return "degraded";
  return "healthy";
}

async function fetchHealthData(): Promise<ServiceHealthResponse> {
  const cached = cache.get(CACHE_KEY);
  if (cached) return cached;

  const pool = getPool();
  const [serviceResult, networkResult] = await Promise.all([
    pool.query(HEALTH_QUERY),
    pool.query(NETWORK_QUERY),
  ]);

  const services: Record<string, ServiceHealth> = {};
  for (const row of serviceResult.rows) {
    services[row.service] = {
      status: statusFromErrorRate(row.error_rate),
      latency: {
        p50: row.p50 !== null ? Math.round(row.p50) : null,
        p95: row.p95 !== null ? Math.round(row.p95) : null,
        p99: row.p99 !== null ? Math.round(row.p99) : null,
      },
      error_rate: row.error_rate !== null ? Math.round(row.error_rate * 1000) / 1000 : null,
      requests_24h: row.last_24h,
      last_called: row.last_called ? new Date(row.last_called).toISOString() : null,
    };
  }

  const networks: Record<string, NetworkHealth> = {};
  for (const row of networkResult.rows) {
    networks[row.network] = {
      status: statusFromErrorRate(row.error_rate),
      requests_24h: row.last_24h,
    };
  }

  const response: ServiceHealthResponse = {
    timestamp: new Date().toISOString(),
    services,
    networks,
  };

  cache.set(CACHE_KEY, response);
  return response;
}

router.get("/api/health/services", async (_req: Request, res: Response) => {
  try {
    const data = await fetchHealthData();
    res.json(data);
  } catch (err: any) {
    console.error("[health] Failed to fetch service health:", err.message);
    res.status(503).json({ error: "Health data unavailable" });
  }
});

export default router;
