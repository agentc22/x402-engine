import { Router, type Request, type Response } from "express";
import { getPrice, getMarkets, getHistorical, getTrending, searchCoin } from "../providers/coingecko.js";
import { logRequest } from "../db/ledger.js";
import { validateIds, validateCurrencies, isValidId, clampInt } from "../lib/validation.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

// 30-second TTL cache for crypto data (CoinGecko updates every ~30s)
const cache = new TTLCache<any>(30_000);

router.get("/api/crypto/price", async (req: Request, res: Response) => {
  const idsRaw = req.query.ids as string | undefined;

  if (!idsRaw) {
    res.status(400).json({ error: "Provide 'ids' query param (e.g. 'bitcoin,ethereum')" });
    return;
  }

  const ids = validateIds(idsRaw);
  if (!ids || ids.length === 0) {
    res.status(400).json({ error: "Invalid 'ids' format — use alphanumeric, comma-separated" });
    return;
  }

  const currenciesRaw = (req.query.currencies as string) || "usd";
  const currencies = validateCurrencies(currenciesRaw);
  if (!currencies) {
    res.status(400).json({ error: "Invalid 'currencies' format" });
    return;
  }

  const include24h = req.query.include_24h !== "false";
  const includeMcap = req.query.include_mcap === "true";

  const cacheKey = `price:${ids.join(",")}:${currencies.join(",")}:${include24h}:${includeMcap}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json({ service: "crypto-price", data: cached, cached: true });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getPrice(ids, currencies, include24h, includeMcap);
    upstreamStatus = 200;
    cache.set(cacheKey, data);
    res.json({ service: "crypto-price", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(502).json({ error: "Upstream error" });
  } finally {
    logRequest({
      service: "crypto-price",
      endpoint: "/api/crypto/price",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/crypto/markets", async (req: Request, res: Response) => {
  const currency = (req.query.currency as string) || "usd";
  if (!/^[a-z]{2,5}$/.test(currency)) {
    res.status(400).json({ error: "Invalid currency code" });
    return;
  }

  const category = req.query.category as string | undefined;
  if (category && !isValidId(category)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  const order = (req.query.order as string) || "market_cap_desc";
  const limit = clampInt(req.query.limit as string, 1, 250, 100);
  const page = clampInt(req.query.page as string, 1, 500, 1);

  const cacheKey = `markets:${currency}:${category}:${order}:${limit}:${page}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json({ service: "crypto-markets", count: cached.length, data: cached, cached: true });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getMarkets(currency, { category, order, perPage: limit, page });
    upstreamStatus = 200;
    cache.set(cacheKey, data);
    res.json({ service: "crypto-markets", count: data.length, data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(502).json({ error: "Upstream error" });
  } finally {
    logRequest({
      service: "crypto-markets",
      endpoint: "/api/crypto/markets",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/crypto/history", async (req: Request, res: Response) => {
  const id = req.query.id as string | undefined;

  if (!id) {
    res.status(400).json({ error: "Provide 'id' query param (e.g. 'bitcoin')" });
    return;
  }
  if (!isValidId(id)) {
    res.status(400).json({ error: "Invalid coin ID format" });
    return;
  }

  const currency = (req.query.currency as string) || "usd";
  const days = req.query.days === "max" ? "max" : clampInt(req.query.days as string, 1, 365, 30);
  const interval = req.query.interval as string | undefined;

  const cacheKey = `history:${id}:${currency}:${days}:${interval}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json({ service: "crypto-history", data: cached, cached: true });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getHistorical(id, currency, days, interval);
    upstreamStatus = 200;
    cache.set(cacheKey, data);
    res.json({ service: "crypto-history", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(502).json({ error: "Upstream error" });
  } finally {
    logRequest({
      service: "crypto-history",
      endpoint: "/api/crypto/history",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/crypto/trending", async (req: Request, res: Response) => {
  const cached = cache.get("trending");
  if (cached) {
    res.json({ service: "crypto-trending", data: cached, cached: true });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getTrending();
    upstreamStatus = 200;
    cache.set("trending", data);
    res.json({ service: "crypto-trending", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(502).json({ error: "Upstream error" });
  } finally {
    logRequest({
      service: "crypto-trending",
      endpoint: "/api/crypto/trending",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/crypto/search", async (req: Request, res: Response) => {
  const q = req.query.q as string | undefined;

  if (!q) {
    res.status(400).json({ error: "Provide 'q' query param (e.g. 'btc')" });
    return;
  }
  if (q.length > 100 || !/^[a-zA-Z0-9 _.-]+$/.test(q)) {
    res.status(400).json({ error: "Invalid search query" });
    return;
  }

  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json({ service: "crypto-search", data: cached, cached: true });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchCoin(q);
    upstreamStatus = 200;
    cache.set(cacheKey, data);
    res.json({ service: "crypto-search", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(502).json({ error: "Upstream error" });
  } finally {
    logRequest({
      service: "crypto-search",
      endpoint: "/api/crypto/search",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
