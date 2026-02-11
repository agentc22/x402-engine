import { Router, type Request, type Response } from "express";
import { simulateTransaction } from "../providers/tenderly.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.post("/api/tx/simulate", async (req: Request, res: Response) => {
  const { network_id, from, to, value, data, gas } = req.body || {};

  // Coerce network_id to string (agents often send numbers like 1 instead of "1")
  const networkId = network_id != null ? String(network_id) : undefined;
  if (!networkId) {
    res.status(400).json({ error: "Provide 'network_id' (e.g. '1' for mainnet, '8453' for Base)" });
    return;
  }

  // Validate addresses — accept mixed case, with or without 0x prefix
  const normalizeAddr = (addr: any): string | null => {
    if (!addr || typeof addr !== "string") return null;
    const a = addr.startsWith("0x") ? addr : `0x${addr}`;
    return /^0x[a-fA-F0-9]{40}$/.test(a) ? a : null;
  };

  const fromAddr = normalizeAddr(from);
  if (!fromAddr) {
    res.status(400).json({ error: "Provide valid 'from' address (0x + 40 hex chars)" });
    return;
  }
  const toAddr = normalizeAddr(to);
  if (!toAddr) {
    res.status(400).json({ error: "Provide valid 'to' address (0x + 40 hex chars)" });
    return;
  }

  // Coerce value to string (agents may send numbers)
  const txValue = value != null ? String(value) : undefined;
  if (data !== undefined && (typeof data !== "string" || !/^0x[a-fA-F0-9]*$/i.test(data))) {
    res.status(400).json({ error: "'data' must be a hex string (0x...)" });
    return;
  }
  // Coerce gas to number
  const txGas = gas != null ? Number(gas) : undefined;
  if (txGas !== undefined && (isNaN(txGas) || txGas < 0)) {
    res.status(400).json({ error: "'gas' must be a positive number" });
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await simulateTransaction(networkId, fromAddr, toAddr, txValue, data, txGas);
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
