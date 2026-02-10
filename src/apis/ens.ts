import { Router, type Request, type Response } from "express";
import { resolveEns, reverseEns } from "../providers/ens.js";
import { logRequest } from "../db/ledger.js";
import { isValidEthAddress } from "../lib/validation.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

// 10-minute TTL cache for ENS (rarely changes)
const cache = new TTLCache<any>(600_000);

const ENS_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,253}\.eth$/;

router.get("/api/ens/resolve", async (req: Request, res: Response) => {
  const name = (req.query.name as string || "").trim().toLowerCase();
  if (!name || !ENS_NAME_RE.test(name)) {
    res.status(400).json({ error: "Provide valid 'name' (e.g. 'vitalik.eth')" });
    return;
  }

  const cacheKey = `ens:resolve:${name}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const address = await resolveEns(name);
    upstreamStatus = 200;
    const result = { name, address };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[ens-resolve] error: ${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "ENS resolution temporarily unavailable", retryable: true });
  } finally {
    logRequest({
      service: "ens-resolve",
      endpoint: "/api/ens/resolve",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/ens/reverse", async (req: Request, res: Response) => {
  const address = (req.query.address as string || "").trim();
  if (!address || !isValidEthAddress(address)) {
    res.status(400).json({ error: "Provide valid 'address' (0x...)" });
    return;
  }

  const cacheKey = `ens:reverse:${address.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const name = await reverseEns(address);
    upstreamStatus = 200;
    const result = { address, name };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[ens-reverse] error: ${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "ENS reverse lookup temporarily unavailable", retryable: true });
  } finally {
    logRequest({
      service: "ens-reverse",
      endpoint: "/api/ens/reverse",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
