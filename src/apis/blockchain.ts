import { Router, type Request, type Response } from "express";
import {
  getWalletBalances,
  getWalletTransactions,
  getTokenPrices,
  getAssets,
} from "../providers/allium.js";
import { logRequest } from "../db/ledger.js";
import { isValidChain, isValidId } from "../lib/validation.js";

const router = Router();

router.post("/api/wallet/balances", async (req: Request, res: Response) => {
  const { chain, address } = req.body || {};

  if (!chain || !address) {
    res.status(400).json({ error: "Provide 'chain' and 'address' in request body" });
    return;
  }
  if (!isValidChain(chain)) {
    res.status(400).json({ error: "Invalid chain name" });
    return;
  }
  if (typeof address !== "string" || address.length > 100) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getWalletBalances([{ chain, address }]);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Failed to fetch wallet balances", retryable: true });
  } finally {
    logRequest({
      service: "wallet-balances",
      endpoint: "/api/wallet/balances",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.post("/api/wallet/transactions", async (req: Request, res: Response) => {
  const { chain, address } = req.body || {};

  if (!chain || !address) {
    res.status(400).json({ error: "Provide 'chain' and 'address' in request body" });
    return;
  }
  if (!isValidChain(chain)) {
    res.status(400).json({ error: "Invalid chain name" });
    return;
  }
  if (typeof address !== "string" || address.length > 100) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getWalletTransactions([{ chain, address }]);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Failed to fetch transactions", retryable: true });
  } finally {
    logRequest({
      service: "wallet-transactions",
      endpoint: "/api/wallet/transactions",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.post("/api/token/prices", async (req: Request, res: Response) => {
  const { tokens } = req.body || {};

  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
    res.status(400).json({ error: "Provide 'tokens' array with {token_address, chain} objects" });
    return;
  }
  if (tokens.length > 200) {
    res.status(400).json({ error: "Maximum 200 tokens per request" });
    return;
  }

  // Validate each token
  for (const t of tokens) {
    if (!t.token_address || typeof t.token_address !== "string" || t.token_address.length > 100) {
      res.status(400).json({ error: "Each token must have a valid 'token_address'" });
      return;
    }
    if (!t.chain || !isValidChain(t.chain)) {
      res.status(400).json({ error: "Each token must have a valid 'chain'" });
      return;
    }
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const data = await getTokenPrices(tokens);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Failed to fetch token prices", retryable: true });
  } finally {
    logRequest({
      service: "token-prices",
      endpoint: "/api/token/prices",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/token/metadata", async (req: Request, res: Response) => {
  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const query: Record<string, string> = {};
    if (req.query.chain) {
      const chain = String(req.query.chain);
      if (!isValidChain(chain)) {
        res.status(400).json({ error: "Invalid chain" });
        return;
      }
      query.chain = chain;
    }
    if (req.query.address) {
      const addr = String(req.query.address);
      if (addr.length > 100) {
        res.status(400).json({ error: "Invalid address" });
        return;
      }
      query.address = addr;
    }
    if (req.query.slug) {
      const slug = String(req.query.slug);
      if (!isValidId(slug)) {
        res.status(400).json({ error: "Invalid slug" });
        return;
      }
      query.slug = slug;
    }
    if (req.query.id) {
      const id = String(req.query.id);
      if (!isValidId(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      query.id = id;
    }

    if (Object.keys(query).length === 0) {
      res.status(400).json({ error: "Provide at least one of: chain+address, slug, or id" });
      return;
    }

    const data = await getAssets(query);
    upstreamStatus = 200;
    res.json(data);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Failed to fetch token metadata", retryable: true });
  } finally {
    logRequest({
      service: "token-metadata",
      endpoint: "/api/token/metadata",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
