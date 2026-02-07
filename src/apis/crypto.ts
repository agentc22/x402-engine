import { Router, type Request, type Response } from "express";
import { getPrice, getMarkets, getHistorical, getTrending, searchCoin } from "../providers/coingecko.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.get("/api/crypto/price", async (req: Request, res: Response) => {
  const idsRaw = req.query.ids as string | undefined;

  if (!idsRaw) {
    res.status(400).json({ error: "Provide 'ids' query param (e.g. 'bitcoin,ethereum')" });
    return;
  }

  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const currencies = ((req.query.currencies as string) || "usd").split(",").map((s) => s.trim());
  const include24h = req.query.include_24h !== "false";
  const includeMcap = req.query.include_mcap === "true";

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getPrice(ids, currencies, include24h, includeMcap);
    upstreamStatus = 200;
    res.json({ service: "crypto-price", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.upstream ? 502 : 500).json({ error: "Upstream error", details: err.upstream || err.message });
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
  const category = req.query.category as string | undefined;
  const order = (req.query.order as string) || "market_cap_desc";
  const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 250);
  const page = parseInt((req.query.page as string) || "1", 10);

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getMarkets(currency, { category, order, perPage: limit, page });
    upstreamStatus = 200;
    res.json({ service: "crypto-markets", count: data.length, data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.upstream ? 502 : 500).json({ error: "Upstream error", details: err.upstream || err.message });
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

  const currency = (req.query.currency as string) || "usd";
  const days = req.query.days === "max" ? "max" : parseInt((req.query.days as string) || "30", 10);
  const interval = req.query.interval as string | undefined;

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getHistorical(id, currency, days, interval);
    upstreamStatus = 200;
    res.json({ service: "crypto-history", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.upstream ? 502 : 500).json({ error: "Upstream error", details: err.upstream || err.message });
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
  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getTrending();
    upstreamStatus = 200;
    res.json({ service: "crypto-trending", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.upstream ? 502 : 500).json({ error: "Upstream error", details: err.upstream || err.message });
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

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await searchCoin(q);
    upstreamStatus = 200;
    res.json({ service: "crypto-search", data });
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.status(err.upstream ? 502 : 500).json({ error: "Upstream error", details: err.upstream || err.message });
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
