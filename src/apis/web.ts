import { Router, type Request, type Response } from "express";
import { scrapeUrl, screenshotUrl } from "../providers/firecrawl.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.get("/api/web/scrape", async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;

  if (!url) {
    res.status(400).json({ error: "Provide 'url' query param" });
    return;
  }
  if (url.length > 2048) {
    res.status(400).json({ error: "URL too long (max 2048 characters)" });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  const formatsRaw = (req.query.formats as string) || "markdown";
  const formats = formatsRaw.split(",").map((f) => f.trim()).filter(Boolean);

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await scrapeUrl(url, formats);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[web-scrape] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "web-scrape",
      endpoint: "/api/web/scrape",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/web/screenshot", async (req: Request, res: Response) => {
  const url = req.query.url as string | undefined;

  if (!url) {
    res.status(400).json({ error: "Provide 'url' query param" });
    return;
  }
  if (url.length > 2048) {
    res.status(400).json({ error: "URL too long (max 2048 characters)" });
    return;
  }

  try {
    new URL(url);
  } catch {
    res.status(400).json({ error: "Invalid URL format" });
    return;
  }

  const fullPage = req.query.full_page === "true";

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await screenshotUrl(url, fullPage);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[web-screenshot] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "web-screenshot",
      endpoint: "/api/web/screenshot",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
