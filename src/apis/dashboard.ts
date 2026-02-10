import { Router } from "express";
import { getPool } from "../db/ledger.js";
import { config } from "../config.js";

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
      last24hRow,
      last7dRow,
      byServiceRows,
      byNetworkRows,
      hourlyRows,
      dailyRows,
      topPayersRows,
      recentRows,
      revenueRows,
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM requests`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at > NOW() - INTERVAL '1 day'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM requests WHERE created_at > NOW() - INTERVAL '7 days'`),
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
        SELECT service, endpoint, payer, network, amount, upstream_status, latency_ms, created_at
        FROM requests ORDER BY created_at DESC LIMIT 50
      `),
      pool.query(`
        SELECT COALESCE(network, 'unknown') AS network,
               SUM(CASE WHEN amount IS NOT NULL THEN amount::numeric ELSE 0 END) AS total_raw
        FROM requests WHERE amount IS NOT NULL
        GROUP BY network
      `),
    ]);

    res.json({
      total: totalRow.rows[0].count,
      last24h: last24hRow.rows[0].count,
      last7d: last7dRow.rows[0].count,
      byService: byServiceRows.rows,
      byNetwork: byNetworkRows.rows,
      hourly: hourlyRows.rows,
      daily: dailyRows.rows,
      topPayers: topPayersRows.rows,
      recent: recentRows.rows,
      revenue: revenueRows.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
  .card { background: #16161f; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; }
  .card .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .card .value { font-size: 32px; font-weight: 700; color: #fff; margin-top: 4px; }
  .card .sub { font-size: 12px; color: #6a6; margin-top: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .panel { background: #16161f; border: 1px solid #2a2a3a; border-radius: 12px; padding: 20px; }
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
<p class="subtitle">Real-time API usage and payments &mdash; <span class="refresh" onclick="load()">Refresh</span></p>

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
  if (n.includes('8453') || n.includes('84532')) return 'net-base';
  if (n.includes('solana')) return 'net-solana';
  if (n.includes('4326')) return 'net-megaeth';
  return 'net-unknown';
}
function netLabel(n) {
  if (!n || n === 'unknown') return 'N/A';
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

    // Cards
    document.getElementById('cards').innerHTML = [
      {l:'Total Requests', v:d.total.toLocaleString()},
      {l:'Last 24h', v:d.last24h.toLocaleString()},
      {l:'Last 7 Days', v:d.last7d.toLocaleString()},
      {l:'Unique Payers', v:d.topPayers.length},
      {l:'NPM Downloads', v:npmAll.downloads.toLocaleString(), s:'This week: '+npmWeek.downloads.toLocaleString()},
      {l:'Networks', v:d.byNetwork.map(n=>netLabel(n.network)).join(', ') || 'None yet'},
    ].map(c=>'<div class="card"><div class="label">'+c.l+'</div><div class="value">'+c.v+'</div>'+(c.s?'<div class="sub">'+c.s+'</div>':'')+'</div>').join('');

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

    // Service table
    const sMax = Math.max(...d.byService.map(s=>s.count), 1);
    document.getElementById('serviceTable').innerHTML = '<table><tr><th>Service</th><th>Requests</th><th></th></tr>'
      + d.byService.map(s=>'<tr><td>'+s.service+'</td><td>'+s.count+'</td><td><div class="bar-wrap"><div class="bar" style="width:'+Math.max(4, s.count/sMax*200)+'px"></div></div></td></tr>').join('')
      + '</table>';

    // Payer table
    document.getElementById('payerTable').innerHTML = d.topPayers.length === 0
      ? '<p style="color:#888;padding:20px">No paying users yet</p>'
      : '<table><tr><th>Payer</th><th>Requests</th><th>Services</th></tr>'
        + d.topPayers.map(p=>'<tr><td class="mono payer-addr" title="'+p.payer+'">'+shortAddr(p.payer)+'</td><td>'+p.requests+'</td><td>'+p.services+'</td></tr>').join('')
        + '</table>';

    // Recent requests
    document.getElementById('recentTable').innerHTML = '<table><tr><th>Time</th><th>Service</th><th>Network</th><th>Payer</th><th>Status</th><th>Latency</th></tr>'
      + d.recent.map(r=>'<tr><td>'+timeAgo(r.created_at)+'</td><td>'+r.service+'</td><td><span class="network-tag '+netClass(r.network)+'">'+netLabel(r.network)+'</span></td><td class="mono payer-addr" title="'+(r.payer||'')+'">'+shortAddr(r.payer)+'</td><td class="'+(r.upstream_status < 400 ? 'status-ok' : 'status-err')+'">'+r.upstream_status+'</td><td>'+r.latency_ms+'ms</td></tr>').join('')
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
