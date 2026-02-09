import { keyPool } from "../lib/key-pool.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_BASE = "https://pro-api.coingecko.com/api/v3";

function isProKey(key: string): boolean {
  // CoinGecko pro keys now also start with "CG-" — the old prefix
  // heuristic no longer works. Use the PRO_API env var to disambiguate,
  // defaulting to pro since free/demo tier doesn't require a key at all.
  if (!key) return false;
  return process.env.COINGECKO_DEMO === "true" ? false : true;
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function geckoFetch(path: string, params?: URLSearchParams): Promise<any> {
  const key = keyPool.acquire("coingecko");

  const baseUrl = key && isProKey(key) ? COINGECKO_PRO_BASE : COINGECKO_BASE;
  const headers: Record<string, string> = {};
  if (key) {
    headers[isProKey(key) ? "x-cg-pro-api-key" : "x-cg-demo-api-key"] = key;
  }

  const url = params ? `${baseUrl}${path}?${params}` : `${baseUrl}${path}`;

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[coingecko] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      // 5xx — transient upstream error, retry
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`CoinGecko ${res.status}`), {
          status: res.status,
        });
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || "CoinGecko API error"), {
          status: res.status,
          upstream: data,
        });
      }
      return data;
    } catch (err: any) {
      // Network errors / timeouts — retry
      if (err.status >= 500 || err.name === "TimeoutError" || err.name === "TypeError") {
        lastErr = err;
        if (attempt < MAX_RETRIES) continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

export async function getPrice(
  ids: string[],
  vsCurrencies: string[],
  include24hChange = true,
  includeMarketCap = false,
): Promise<any> {
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: vsCurrencies.join(","),
    include_24hr_change: String(include24hChange),
    include_market_cap: String(includeMarketCap),
  });
  return geckoFetch("/simple/price", params);
}

export async function getMarkets(
  vsCurrency: string,
  opts: { ids?: string[]; category?: string; order?: string; perPage?: number; page?: number } = {},
): Promise<any> {
  const params = new URLSearchParams({
    vs_currency: vsCurrency,
    order: opts.order || "market_cap_desc",
    per_page: String(opts.perPage || 100),
    page: String(opts.page || 1),
    sparkline: "false",
  });
  if (opts.ids) params.set("ids", opts.ids.join(","));
  if (opts.category) params.set("category", opts.category);
  return geckoFetch("/coins/markets", params);
}

export async function getHistorical(
  id: string,
  vsCurrency: string,
  days: number | string,
  interval?: string,
): Promise<any> {
  const params = new URLSearchParams({
    vs_currency: vsCurrency,
    days: String(days),
  });
  if (interval) params.set("interval", interval);
  return geckoFetch(`/coins/${encodeURIComponent(id)}/market_chart`, params);
}

export async function getTrending(): Promise<any> {
  return geckoFetch("/search/trending");
}

export async function searchCoin(query: string): Promise<any> {
  const params = new URLSearchParams({ query });
  return geckoFetch("/search", params);
}
