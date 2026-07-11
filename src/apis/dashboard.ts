import { Router } from "express";
import { getPool } from "../db/ledger.js";
import { config } from "../config.js";
import { getAllServices } from "../services/registry.js";
import { calculateLifetimeMetrics, LIFETIME_AUDIT, rawToUsd } from "../dashboard/lifetime.js";

const router = Router();

// Auth: requires ?key=DASHBOARD_SECRET or DEV_BYPASS_SECRET
function authCheck(req: any, res: any, next: any) {
  const key = req.query.key as string;
  const secret = config.dashboardSecret || config.devBypassSecret;
  if (!secret || key !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// JSON API for dashboard data
router.get("/api/dashboard/stats", authCheck, async (_req, res) => {
  try {
    const pool = getPool();
    const [
      totalRow,
      apiTotalRow,
      paymentEventsRow,
      last24hRow,
      apiLast24hRow,
      last7dRow,
      apiLast7dRow,
      byServiceRows,
      byNetworkRows,
      hourlyRows,
      dailyRows,
      topPayersRows,
      recentRows,
      revenueRows,
      uniquePayersRow,
      dailyRevenueRows,
      revenue24hRows,
      revenue7dRows,
      dailyRevenueAmountRows,
      lifetimeSettlementRows,
      preAuditServiceRows,
      postAuditServiceRows,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM requests`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE service != 'megaeth-payment'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE service = 'megaeth-payment'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at > NOW() - INTERVAL '1 day'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at > NOW() - INTERVAL '1 day' AND service != 'megaeth-payment'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at > NOW() - INTERVAL '7 days'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at > NOW() - INTERVAL '7 days' AND service != 'megaeth-payment'`),
      pool.query(`SELECT service, COUNT(*)::int AS count FROM requests GROUP BY service ORDER BY count DESC`),
      pool.query(`SELECT COALESCE(network, 'unknown') AS network, COUNT(*)::int AS count FROM requests WHERE network IS NOT NULL GROUP BY network ORDER BY count DESC`),
      pool.query(`
        SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS count
        FROM requests WHERE created_at > NOW() - INTERVAL '48 hours'
        GROUP BY hour ORDER BY hour
      `),
      pool.query(`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS count
        FROM requests WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY day ORDER BY day
      `),
      pool.query(`
        SELECT payer, COUNT(*)::int AS requests, COUNT(DISTINCT service) AS services
        FROM requests WHERE payer IS NOT NULL
        GROUP BY payer ORDER BY requests DESC LIMIT 20
      `),
      pool.query(`
        SELECT service, endpoint, payer, network, amount, upstream_status, latency_ms, created_at,
               CASE
                 WHEN service = 'megaeth-payment' THEN 'payment-verification'
                 WHEN network = 'dev-bypass' THEN 'dev-bypass'
                 WHEN payer IS NOT NULL OR network IS NOT NULL OR amount IS NOT NULL THEN 'paid'
                 WHEN upstream_status > 0 AND upstream_status < 400 THEN 'legacy-unattributed'
                 ELSE 'unknown'
               END AS payment_state
        FROM requests ORDER BY created_at DESC LIMIT 50
      `),
      pool.query(`
        SELECT COALESCE(network, 'unknown') AS network,
               SUM(CASE WHEN amount IS NOT NULL THEN amount::numeric ELSE 0 END) AS total_raw
        FROM requests WHERE amount IS NOT NULL AND service != 'megaeth-payment'
        GROUP BY network
      `),
      pool.query(`SELECT COUNT(DISTINCT payer)::int AS count FROM requests WHERE payer IS NOT NULL`),
      pool.query(`
        SELECT date_trunc('day', created_at)::date AS day,
               COALESCE(network, 'unknown') AS network,
               COUNT(*)::int AS requests,
               COUNT(DISTINCT payer)::int AS unique_payers
        FROM requests WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY day, network ORDER BY day
      `),
      // Revenue last 24h
      pool.query(`
        SELECT COALESCE(network, 'unknown') AS network,
               SUM(CASE WHEN amount IS NOT NULL THEN amount::numeric ELSE 0 END) AS total_raw
        FROM requests WHERE amount IS NOT NULL AND service != 'megaeth-payment'
          AND created_at > NOW() - INTERVAL '1 day'
        GROUP BY network
      `),
      // Revenue last 7d
      pool.query(`
        SELECT COALESCE(network, 'unknown') AS network,
               SUM(CASE WHEN amount IS NOT NULL THEN amount::numeric ELSE 0 END) AS total_raw
        FROM requests WHERE amount IS NOT NULL AND service != 'megaeth-payment'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY network
      `),
      // Daily revenue amounts (30d) for chart
      pool.query(`
        SELECT date_trunc('day', created_at)::date AS day,
               SUM(CASE
                 WHEN network LIKE '%4326%' THEN amount::numeric / 1e18
                 ELSE amount::numeric / 1e6
               END) AS usd
        FROM requests WHERE amount IS NOT NULL AND service != 'megaeth-payment'
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY day ORDER BY day
      `),
      pool.query(`
        SELECT network, COUNT(*)::int AS count, SUM(amount::numeric) AS total_raw
        FROM requests
        WHERE amount IS NOT NULL AND (
          (network = $1 AND service != 'megaeth-payment' AND created_at > $2) OR
          (network = $3 AND service = 'megaeth-payment' AND created_at > $4) OR
          (network = $5 AND service != 'megaeth-payment' AND created_at > $6)
        )
        GROUP BY network
      `, [
        LIFETIME_AUDIT.chains[0].network,
        LIFETIME_AUDIT.chains[0].auditedThrough,
        LIFETIME_AUDIT.chains[1].network,
        LIFETIME_AUDIT.chains[1].auditedThrough,
        LIFETIME_AUDIT.chains[2].network,
        LIFETIME_AUDIT.chains[2].auditedThrough,
      ]),
      pool.query(`
        SELECT service, COUNT(*)::int AS count
        FROM requests
        WHERE amount IS NOT NULL AND service != 'megaeth-payment' AND (
          (network = $1 AND created_at <= $2) OR
          (network = $3 AND created_at <= $4) OR
          (network = $5 AND created_at <= $6)
        )
        GROUP BY service
      `, [
        LIFETIME_AUDIT.chains[0].network,
        LIFETIME_AUDIT.chains[0].auditedThrough,
        LIFETIME_AUDIT.chains[1].network,
        LIFETIME_AUDIT.chains[1].auditedThrough,
        LIFETIME_AUDIT.chains[2].network,
        LIFETIME_AUDIT.chains[2].auditedThrough,
      ]),
      pool.query(`
        SELECT service, COUNT(*)::int AS count
        FROM requests
        WHERE amount IS NOT NULL AND service != 'megaeth-payment' AND (
          (network = $1 AND created_at > $2) OR
          (network = $3 AND created_at > $4) OR
          (network = $5 AND created_at > $6)
        )
        GROUP BY service
      `, [
        LIFETIME_AUDIT.chains[0].network,
        LIFETIME_AUDIT.chains[0].auditedThrough,
        LIFETIME_AUDIT.chains[1].network,
        LIFETIME_AUDIT.chains[1].auditedThrough,
        LIFETIME_AUDIT.chains[2].network,
        LIFETIME_AUDIT.chains[2].auditedThrough,
      ]),
    ]);

    // Build cost/price maps from services config
    const services = getAllServices();
    const costMap: Record<string, number> = {};
    const priceMap: Record<string, number> = {};
    for (const svc of services) {
      const price = parseFloat(svc.price.replace("$", "")) || 0;
      const cost = parseFloat((svc.cost || "$0").replace("$", "")) || 0;
      costMap[svc.id] = cost;
      priceMap[svc.id] = price;
    }

    // Compute actual on-chain revenue (from DB amounts, not config prices)
    const actualRevenue = (revenueRows.rows as any[]).reduce(
      (sum: number, r: any) => sum + rawToUsd(r.total_raw, r.network), 0
    );

    const revenue24h = (revenue24hRows.rows as any[]).reduce(
      (sum: number, r: any) => sum + rawToUsd(r.total_raw, r.network), 0
    );
    const revenue7d = (revenue7dRows.rows as any[]).reduce(
      (sum: number, r: any) => sum + rawToUsd(r.total_raw, r.network), 0
    );
    const lifetime = calculateLifetimeMetrics(
      lifetimeSettlementRows.rows,
      preAuditServiceRows.rows,
      postAuditServiceRows.rows,
      costMap,
    );

    // Compute costs from service call counts
    let totalCost = 0;
    const serviceProfits: { service: string; count: number; revenue: number; cost: number; profit: number; margin: number }[] = [];
    for (const row of byServiceRows.rows) {
      const cost = (costMap[row.service] || 0) * row.count;
      const rev = (priceMap[row.service] || 0) * row.count;
      totalCost += cost;
      serviceProfits.push({
        service: row.service,
        count: row.count,
        revenue: rev,
        cost,
        profit: rev - cost,
        margin: rev > 0 ? ((rev - cost) / rev) * 100 : 0,
      });
    }

    // Fetch GitHub stats server-side (avoids CORS issues on client)
    let github = { views: 0, clones: 0, uniqueCloners: 0 };
    try {
      const ghToken = process.env.GITHUB_TOKEN;
      if (ghToken) {
        const headers = { Authorization: `token ${ghToken}`, Accept: "application/vnd.github.v3+json" };
        const [viewsRes, clonesRes] = await Promise.all([
          fetch("https://api.github.com/repos/agentc22/x402engine-mcp/traffic/views", { headers }).then(r => r.json()).catch(() => ({})),
          fetch("https://api.github.com/repos/agentc22/x402engine-mcp/traffic/clones", { headers }).then(r => r.json()).catch(() => ({})),
        ]);
        github = { views: viewsRes.count || 0, clones: clonesRes.count || 0, uniqueCloners: clonesRes.uniques || 0 };
      }
    } catch { /* ignore */ }

    res.json({
      total: totalRow.rows[0].count,
      apiTotal: apiTotalRow.rows[0].count,
      paymentEvents: paymentEventsRow.rows[0].count,
      last24h: last24hRow.rows[0].count,
      apiLast24h: apiLast24hRow.rows[0].count,
      last7d: last7dRow.rows[0].count,
      apiLast7d: apiLast7dRow.rows[0].count,
      uniquePayers: uniquePayersRow.rows[0].count,
      byService: byServiceRows.rows,
      byNetwork: byNetworkRows.rows,
      hourly: hourlyRows.rows,
      daily: dailyRows.rows,
      dailyRevenue: dailyRevenueRows.rows,
      topPayers: topPayersRows.rows,
      recent: recentRows.rows,
      revenue: revenueRows.rows,
      revenue24h,
      revenue7d,
      dailyRevenueChart: dailyRevenueAmountRows.rows,
      lifetime,
      github,
      profit: {
        ...lifetime.profit,
        trackedRevenue: actualRevenue,
        trackedCost: totalCost,
        byService: serviceProfits,
      },
    });
  } catch (err: any) {
    // Avoid leaking internal error details/config values to API consumers
    res.status(500).json({ error: "Internal server error" });
  }
});

// Read-only admin diagnostics for validating dashboard counters against the live DB.
router.get("/api/dashboard/diagnostics", authCheck, async (_req, res) => {
  try {
    const pool = getPool();
    const [
      requestSummary,
      tableStats,
      monthlyRows,
      serviceRows,
      txSummary,
      dbIdentity,
      oldestRows,
      newestRows,
    ] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE service != 'megaeth-payment')::int AS api_total,
          COUNT(*) FILTER (WHERE service = 'megaeth-payment')::int AS payment_events,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS last_24h,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last_30d,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '90 days')::int AS within_90d,
          COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '90 days')::int AS older_than_90d,
          COUNT(*) FILTER (WHERE upstream_status = 404)::int AS upstream_404,
          COUNT(*) FILTER (WHERE upstream_status = 404 AND created_at >= NOW() - INTERVAL '1 day')::int AS upstream_404_24h,
          MIN(created_at) AS first_request_at,
          MAX(created_at) AS last_request_at
        FROM requests
      `),
      pool.query(`
        SELECT
          c.relname AS table_name,
          c.reltuples::bigint AS estimated_rows,
          c.relpages::int AS pages,
          pg_total_relation_size(c.oid)::bigint AS total_bytes,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema()
          AND c.relname IN ('requests', 'used_tx_hashes')
        ORDER BY c.relname
      `),
      pool.query(`
        SELECT date_trunc('month', created_at)::date AS month,
               COUNT(*)::int AS count,
               MIN(created_at) AS first_at,
               MAX(created_at) AS last_at
        FROM requests
        GROUP BY month
        ORDER BY month
      `),
      pool.query(`
        SELECT service,
               COUNT(*)::int AS count,
               COUNT(*) FILTER (WHERE upstream_status = 404)::int AS upstream_404,
               MIN(created_at) AS first_at,
               MAX(created_at) AS last_at
        FROM requests
        GROUP BY service
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT COUNT(*)::int AS total,
               MIN(created_at) AS first_tx_at,
               MAX(created_at) AS last_tx_at
        FROM used_tx_hashes
      `),
      pool.query(`
        SELECT current_database() AS database,
               current_schema() AS schema,
               current_user AS db_user,
               inet_server_addr()::text AS server_addr,
               inet_server_port() AS server_port,
               current_setting('server_version') AS server_version
      `),
      pool.query(`
        SELECT service, endpoint, upstream_status, created_at
        FROM requests
        ORDER BY created_at ASC
        LIMIT 10
      `),
      pool.query(`
        SELECT service, endpoint, upstream_status, created_at
        FROM requests
        ORDER BY created_at DESC
        LIMIT 10
      `),
    ]);

    const tableMetadata = Object.fromEntries(
      tableStats.rows.map((row: any) => [
        row.table_name,
        {
          estimatedRows: Number(row.estimated_rows),
          pages: row.pages,
          totalBytes: Number(row.total_bytes),
          totalSize: row.total_size,
        },
      ]),
    );

    res.json({
      timestamp: new Date().toISOString(),
      database: dbIdentity.rows[0],
      railway: {
        projectId: process.env.RAILWAY_PROJECT_ID ?? null,
        environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? null,
        environmentName: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
        serviceId: process.env.RAILWAY_SERVICE_ID ?? null,
        serviceName: process.env.RAILWAY_SERVICE_NAME ?? null,
        publicDomain: process.env.RAILWAY_PUBLIC_DOMAIN ?? null,
      },
      requests: requestSummary.rows[0],
      usedTxHashes: txSummary.rows[0],
      tables: tableMetadata,
      byMonth: monthlyRows.rows,
      byService: serviceRows.rows,
      samples: {
        oldest: oldestRows.rows,
        newest: newestRows.rows,
      },
    });
  } catch (err: any) {
    console.error("[dashboard] Diagnostics failed:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Dashboard HTML page
router.get("/dashboard", authCheck, (_req, res) => {
  const key = _req.query.key;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>x402 Engine Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e0e0e0; padding: 20px; }
  h1 { font-size: 24px; margin-bottom: 4px; color: #fff; }
  .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 8px; padding: 20px; }
  .card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .card .value { font-size: 32px; font-weight: 700; color: #fff; margin-top: 4px; }
  .card .sub { font-size: 12px; color: #6a6; margin-top: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .panel { background: #16161f; border: 1px solid #2a2a3a; border-radius: 8px; padding: 20px; }
  .panel h2 { font-size: 16px; margin-bottom: 12px; color: #ccc; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #888; font-weight: 500; border-bottom: 1px solid #2a2a3a; }
  td { padding: 8px 12px; border-bottom: 1px solid #1a1a2a; }
  .mono { font-family: 'SF Mono', monospace; font-size: 12px; }
  .bar { height: 8px; background: #3b82f6; border-radius: 4px; min-width: 2px; }
  .bar-wrap { display: flex; align-items: center; gap: 8px; }
  .bar-label { min-width: 50px; text-align: right; font-size: 12px; color: #888; }
  .network-tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .net-base { background: #1d4ed822; color: #60a5fa; }
  .net-solana { background: #9333ea22; color: #c084fc; }
  .net-megaeth { background: #f5920022; color: #fbbf24; }
  .net-unknown { background: #33333366; color: #888; }
  .status-ok { color: #6a6; }
  .status-err { color: #f66; }
  .chart { width: 100%; height: 120px; display: flex; align-items: flex-end; gap: 2px; }
  .chart-bar { background: #3b82f6; border-radius: 2px 2px 0 0; min-width: 4px; flex: 1; transition: height 0.3s; }
  .chart-bar:hover { background: #60a5fa; }
  .loading { text-align: center; padding: 40px; color: #888; }
  .refresh { color: #3b82f6; cursor: pointer; font-size: 13px; float: right; }
  .refresh:hover { text-decoration: underline; }
  .payer-addr { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 768px) { .grid2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>x402 Engine <span style="color:#3b82f6">Dashboard</span></h1>
<p class="subtitle">Audited lifetime settlements and real-time API usage &mdash; <span class="refresh" onclick="load()">Refresh</span></p>

<div class="cards" id="cards"><div class="loading">Loading...</div></div>

<div class="grid2">
  <div class="panel">
    <h2>Requests (48h)</h2>
    <div class="chart" id="hourlyChart"></div>
  </div>
  <div class="panel">
    <h2>Requests (30d)</h2>
    <div class="chart" id="dailyChart"></div>
  </div>
</div>

<div class="panel" style="margin-bottom:16px">
  <h2>Daily Revenue (30d)</h2>
  <div class="chart" id="revenueChart"></div>
</div>

<div class="grid2">
  <div class="panel">
    <h2>By Service</h2>
    <div id="serviceTable"></div>
  </div>
  <div class="panel">
    <h2>Top Payers</h2>
    <div id="payerTable"></div>
  </div>
</div>

<div class="panel" style="margin-top:16px">
  <h2>Recent Requests</h2>
  <div style="overflow-x:auto" id="recentTable"></div>
</div>

<script>
const KEY = ${JSON.stringify(key)};
function netClass(n) {
  if (!n) return 'net-unknown';
  if (n === 'dev-bypass') return 'net-unknown';
  if (n.includes('8453') || n.includes('84532')) return 'net-base';
  if (n.includes('solana')) return 'net-solana';
  if (n.includes('4326')) return 'net-megaeth';
  return 'net-unknown';
}
function netLabel(n) {
  if (!n || n === 'unknown') return 'N/A';
  if (n === 'dev-bypass') return 'Dev bypass';
  if (n.includes('8453')) return 'Base';
  if (n.includes('84532')) return 'Base Sep';
  if (n.includes('solana')) return 'Solana';
  if (n.includes('4326')) return 'MegaETH';
  return n.slice(0, 16);
}
function shortAddr(a) {
  if (!a) return '-';
  if (a.length > 16) return a.slice(0, 6) + '...' + a.slice(-4);
  return a;
}
function payerLabel(r) {
  if (r.payer) return shortAddr(r.payer);
  if (r.payment_state === 'payment-verification') return 'Verification';
  if (r.network === 'dev-bypass') return 'Dev bypass';
  if (r.payment_state === 'legacy-unattributed') return 'Legacy unattributed';
  if (r.network && r.network.includes('solana') && r.amount) return 'Verified';
  return '-';
}
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
async function load() {
  try {
    const [r, npmWeek, npmAll] = await Promise.all([
      fetch('/api/dashboard/stats?key=' + KEY),
      fetch('https://api.npmjs.org/downloads/point/last-week/x402engine-mcp').then(r=>r.json()).catch(()=>({downloads:0})),
      fetch('https://api.npmjs.org/downloads/point/2000-01-01:2099-12-31/x402engine-mcp').then(r=>r.json()).catch(()=>({downloads:0})),
    ]);
    const d = await r.json();
    if (d.error) { document.getElementById('cards').innerHTML = '<div class="card"><div class="value" style="color:#f66">Error</div><div class="label">'+d.error+'</div></div>'; return; }

    // Profit data
    const p = d.profit || {};
    const lifetime = d.lifetime || {};
    const lifetimeChains = lifetime.byChain || [];

    // Cards
    document.getElementById('cards').innerHTML = [
      {l:'Lifetime Sold Requests', v:(lifetime.totalRequests||0).toLocaleString(), s:lifetimeChains.map(c=>netLabel(c.network)+': '+c.totalRequests.toLocaleString()).join(' | ')+' | +'+(lifetime.incrementalRequests||0).toLocaleString()+' since audit'},
      {l:'Tracked API Rows', v:(d.apiTotal||0).toLocaleString(), s:'Database rows retained for service-level analytics'},
      {l:'Last 24h', v:d.last24h.toLocaleString(), s:'Paid API: '+(d.apiLast24h||0).toLocaleString()},
      {l:'Last 7 Days', v:d.last7d.toLocaleString(), s:'Paid API: '+(d.apiLast7d||0).toLocaleString()},
      {l:'Unique Payers', v:d.uniquePayers.toLocaleString()},
      {l:'Revenue 24h', v:'$'+(d.revenue24h||0).toFixed(2), s:'Last 24 hours', green: (d.revenue24h||0) > 0},
      {l:'Revenue 7d', v:'$'+(d.revenue7d||0).toFixed(2), s:'Last 7 days', green: (d.revenue7d||0) > 0},
      {l:'Lifetime Revenue', v:'$'+(lifetime.totalRevenue||0).toFixed(2), s:lifetimeChains.map(c=>netLabel(c.network)+': $'+c.totalRevenueUsd.toFixed(3)).join(' | ')+' | +$'+(lifetime.incrementalRevenue||0).toFixed(3)+' since audit'},
      {l:'Est. Lifetime Cost', v:'$'+(p.totalCost||0).toFixed(2), s:'Based on retained service mix and configured upstream costs'},
      {l:'Est. Lifetime Profit', v:'$'+(p.totalProfit||0).toFixed(2), s:'Estimated margin: '+(p.margin||0).toFixed(1)+'%', green: (p.totalProfit||0) > 0},
      {l:'NPM Downloads', v:npmAll.downloads.toLocaleString(), s:'This week: '+npmWeek.downloads.toLocaleString()},
      {l:'GitHub (14d)', v:d.github.clones+' clones', s:d.github.uniqueCloners+' unique cloners, '+d.github.views+' views'},
      {l:'Networks', v:d.byNetwork.map(n=>netLabel(n.network)).join(', ') || 'None yet'},
    ].map(c=>'<div class="card"><div class="label">'+c.l+'</div><div class="value"'+(c.green?' style="color:#4ade80"':'')+'>'+c.v+'</div>'+(c.s?'<div class="sub">'+c.s+'</div>':'')+'</div>').join('');

    // Hourly chart
    const hMax = Math.max(...d.hourly.map(h=>h.count), 1);
    document.getElementById('hourlyChart').innerHTML = d.hourly.map(h=>
      '<div class="chart-bar" style="height:'+Math.max(4, h.count/hMax*120)+'px" title="'+new Date(h.hour).toLocaleString()+': '+h.count+'"></div>'
    ).join('');

    // Daily chart
    const dMax = Math.max(...d.daily.map(h=>h.count), 1);
    document.getElementById('dailyChart').innerHTML = d.daily.map(h=>
      '<div class="chart-bar" style="height:'+Math.max(4, h.count/dMax*120)+'px" title="'+h.day+': '+h.count+'"></div>'
    ).join('');

    // Daily revenue chart
    const revChart = d.dailyRevenueChart || [];
    if (revChart.length > 0) {
      const rMax = Math.max(...revChart.map(r=>Number(r.usd)), 0.01);
      document.getElementById('revenueChart').innerHTML = revChart.map(r=>
        '<div class="chart-bar" style="height:'+Math.max(4, Number(r.usd)/rMax*120)+'px;background:#4ade80" title="'+r.day+': $'+Number(r.usd).toFixed(2)+'"></div>'
      ).join('');
    } else {
      document.getElementById('revenueChart').innerHTML = '<p style="color:#888;padding:20px">No revenue data yet</p>';
    }

    // Service table with profit breakdown
    const profitMap = {};
    (p.byService||[]).forEach(s => { profitMap[s.service] = s; });
    const sMax = Math.max(...d.byService.map(s=>s.count), 1);
    document.getElementById('serviceTable').innerHTML = '<table><tr><th>Service</th><th>Calls</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr>'
      + d.byService.map(s=>{
        const sp = profitMap[s.service] || {revenue:0,cost:0,profit:0,margin:0};
        return '<tr><td>'+s.service+'</td><td>'+s.count+'</td><td>$'+sp.revenue.toFixed(2)+'</td><td>$'+sp.cost.toFixed(2)+'</td><td style="color:'+(sp.profit>=0?'#4ade80':'#f66')+'">$'+sp.profit.toFixed(2)+'</td><td>'+sp.margin.toFixed(0)+'%</td></tr>';
      }).join('')
      + '</table>';

    // Payer table
    document.getElementById('payerTable').innerHTML = d.topPayers.length === 0
      ? '<p style="color:#888;padding:20px">No paying users yet</p>'
      : '<table><tr><th>Payer</th><th>Requests</th><th>Services</th></tr>'
        + d.topPayers.map(p=>'<tr><td class="mono payer-addr" title="'+p.payer+'">'+shortAddr(p.payer)+'</td><td>'+p.requests+'</td><td>'+p.services+'</td></tr>').join('')
        + '</table>';

    // Recent requests
    document.getElementById('recentTable').innerHTML = '<table><tr><th>Time</th><th>Service</th><th>Network</th><th>Payer</th><th>Status</th><th>Latency</th></tr>'
      + d.recent.map(r=>'<tr><td>'+timeAgo(r.created_at)+'</td><td>'+r.service+'</td><td><span class="network-tag '+netClass(r.network)+'">'+netLabel(r.network)+'</span></td><td class="mono payer-addr" title="'+(r.payer||payerLabel(r))+'">'+payerLabel(r)+'</td><td class="'+(r.upstream_status > 0 && r.upstream_status < 400 ? 'status-ok' : 'status-err')+'">'+r.upstream_status+'</td><td>'+r.latency_ms+'ms</td></tr>').join('')
      + '</table>';

  } catch(e) {
    document.getElementById('cards').innerHTML = '<div class="card"><div class="value" style="color:#f66">Failed</div><div class="label">'+e.message+'</div></div>';
  }
}
load();
setInterval(load, 30000);
</script>
</body>
</html>`);
});

export default router;
