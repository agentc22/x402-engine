import { config } from "../config.js";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_BASE = "https://pro-api.coingecko.com/api/v3";

function isProKey(key: string): boolean {
  return !!key && !key.startsWith("CG-");
}

function getBaseUrl(): string {
  return config.coingeckoApiKey && isProKey(config.coingeckoApiKey)
    ? COINGECKO_PRO_BASE
    : COINGECKO_BASE;
}

function getHeaders(): Record<string, string> {
  if (!config.coingeckoApiKey) return {};
  if (isProKey(config.coingeckoApiKey)) {
    return { "x-cg-pro-api-key": config.coingeckoApiKey };
  }
  return { "x-cg-demo-api-key": config.coingeckoApiKey };
}

async function geckoFetch(path: string, params?: URLSearchParams): Promise<any> {
  const url = params
    ? `${getBaseUrl()}${path}?${params}`
    : `${getBaseUrl()}${path}`;
  const res = await fetch(url, { headers: getHeaders() });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.error || "CoinGecko API error"), {
      status: res.status,
      upstream: data,
    });
  }
  return data;
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
