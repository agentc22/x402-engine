import { Router, type Request, type Response } from "express";
import { search, getContents } from "../providers/exa.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.post("/api/search/web", async (req: Request, res: Response) => {
  const { query, numResults, includeDomains, category, includeText } = req.body || {};

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Provide 'query' string in request body" });
    return;
  }
  if (query.length > 2000) {
    res.status(400).json({ error: "Query too long (max 2000 characters)" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await search(query, {
      numResults: typeof numResults === "number" ? Math.min(numResults, 30) : undefined,
      includeDomains: Array.isArray(includeDomains) ? includeDomains : undefined,
      category: typeof category === "string" ? category : undefined,
      includeText: !!includeText,
    });
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[search-web] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "search-web",
      endpoint: "/api/search/web",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.post("/api/search/contents", async (req: Request, res: Response) => {
  const { urls } = req.body || {};

  if (!Array.isArray(urls) || urls.length === 0) {
    res.status(400).json({ error: "Provide 'urls' array in request body" });
    return;
  }
  if (urls.length > 10) {
    res.status(400).json({ error: "Maximum 10 URLs per request" });
    return;
  }
  for (const u of urls) {
    if (typeof u !== "string") {
      res.status(400).json({ error: "Each URL must be a string" });
      return;
    }
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getContents(urls);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[search-contents] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "search-contents",
      endpoint: "/api/search/contents",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
