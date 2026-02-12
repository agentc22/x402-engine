import { keyPool } from "../lib/key-pool.js";

const ALLIUM_BASE = "https://api.allium.so/api/v1/developer";

async function alliumPost(path: string, body: unknown, query?: Record<string, string>): Promise<any> {
  const key = keyPool.acquire("allium");
  if (!key) {
    throw Object.assign(new Error("Allium API key not configured"), { status: 502 });
  }

  const url = new URL(`${ALLIUM_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Allium API error: ${res.status}`), {
      status: 502,
      upstream: text,
    });
  }

  return res.json();
}

async function alliumGet(path: string, query?: Record<string, string>): Promise<any> {
  const key = keyPool.acquire("allium");
  if (!key) {
    throw Object.assign(new Error("Allium API key not configured"), { status: 502 });
  }

  const url = new URL(`${ALLIUM_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key,
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Allium API error: ${res.status}`), {
      status: 502,
      upstream: text,
    });
  }

  return res.json();
}

/** Token balances for a wallet across one or more chains */
export async function getWalletBalances(
  addresses: Array<{ chain: string; address: string }>,
): Promise<any> {
  return alliumPost("/wallet/balances", addresses);
}

/** Transaction history for a wallet */
export async function getWalletTransactions(
  addresses: Array<{ chain: string; address: string }>,
): Promise<any> {
  return alliumPost("/wallet/transactions", addresses);
}

/** Portfolio P&L for a wallet (realized + unrealized) */
export async function getWalletPnl(
  addresses: Array<{ chain: string; address: string }>,
  minLiquidity?: number,
  minVolume24h?: number,
): Promise<any> {
  const query: Record<string, string> = {};
  if (minLiquidity !== undefined) query.min_liquidity = String(minLiquidity);
  if (minVolume24h !== undefined) query.min_volume_24h = String(minVolume24h);
  return alliumPost("/wallet/pnl", addresses, query);
}

/** Latest prices for tokens (up to 200 per request) */
export async function getTokenPrices(
  tokens: Array<{ token_address: string; chain: string }>,
): Promise<any> {
  return alliumPost("/prices", tokens);
}

/** Token/asset metadata by ID, slug, or chain+address */
export async function getAssets(
  query?: Record<string, string>,
): Promise<any> {
  return alliumGet("/assets", query);
}
