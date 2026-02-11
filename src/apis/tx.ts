import { Router, type Request, type Response } from "express";
import { simulateTransaction } from "../providers/tenderly.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.post("/api/tx/simulate", async (req: Request, res: Response) => {
  const { network_id, from, to, value, data, gas } = req.body || {};

  if (!network_id || typeof network_id !== "string") {
    res.status(400).json({ error: "Provide 'network_id' (string, e.g. '1' for mainnet, '8453' for Base)" });
    return;
  }
  if (!from || typeof from !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(from)) {
    res.status(400).json({ error: "Provide valid 'from' address (0x...)" });
    return;
  }
  if (!to || typeof to !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(to)) {
    res.status(400).json({ error: "Provide valid 'to' address (0x...)" });
    return;
  }

  if (value !== undefined && typeof value !== "string") {
    res.status(400).json({ error: "'value' must be a string (wei amount)" });
    return;
  }
  if (data !== undefined && (typeof data !== "string" || !/^0x[a-fA-F0-9]*$/.test(data))) {
    res.status(400).json({ error: "'data' must be a hex string (0x...)" });
    return;
  }
  if (gas !== undefined && (typeof gas !== "number" || gas < 0)) {
    res.status(400).json({ error: "'gas' must be a positive number" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await simulateTransaction(network_id, from, to, value, data, gas);
    upstreamStatus = 200;
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[tx-simulate] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "tx-simulate",
      endpoint: "/api/tx/simulate",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
