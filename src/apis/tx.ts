import { Router, type Request, type Response } from "express";
import { simulateTransaction } from "../providers/tenderly.js";
import { logRequest } from "../db/ledger.js";

const router = Router();

router.post("/api/tx/simulate", async (req: Request, res: Response) => {
  const body = req.body || {};

  // Accept common field name variants
  const rawNetworkId = body.network_id ?? body.networkId ?? body.chain_id ?? body.chainId ?? body.network;
  const rawFrom = body.from ?? body.sender;
  const rawTo = body.to ?? body.recipient ?? body.target;
  const rawValue = body.value ?? body.amount;
  const rawData = body.data ?? body.input ?? body.calldata;
  const rawGas = body.gas ?? body.gas_limit ?? body.gasLimit;

  // Coerce network_id to string (agents often send numbers)
  const networkId = rawNetworkId != null ? String(rawNetworkId) : undefined;
  if (!networkId) {
    res.status(400).json({
      error: "Provide 'network_id' (e.g. '1' for mainnet, '8453' for Base)",
      accepted_fields: ["network_id", "networkId", "chain_id", "chainId"],
    });
    return;
  }

  // Normalize addresses — accept with/without 0x prefix, mixed case
  const normalizeAddr = (addr: any): string | null => {
    if (addr == null || typeof addr !== "string" || addr.length === 0) return null;
    const a = addr.startsWith("0x") || addr.startsWith("0X") ? addr : `0x${addr}`;
    return /^0x[a-fA-F0-9]{40}$/i.test(a) ? a : null;
  };

  const fromAddr = normalizeAddr(rawFrom);
  if (!fromAddr) {
    res.status(400).json({
      error: "Provide valid 'from' address (0x + 40 hex chars)",
      accepted_fields: ["from", "sender"],
    });
    return;
  }
  const toAddr = normalizeAddr(rawTo);
  if (!toAddr) {
    res.status(400).json({
      error: "Provide valid 'to' address (0x + 40 hex chars)",
      accepted_fields: ["to", "recipient", "target"],
    });
    return;
  }

  // Coerce value to string (agents may send numbers or omit)
  const txValue = rawValue != null ? String(rawValue) : undefined;

  // Data must be a hex string if present; treat null/""/undefined as absent
  let txData: string | undefined;
  if (rawData != null && rawData !== "") {
    if (typeof rawData !== "string" || !/^0x[a-fA-F0-9]*$/i.test(rawData)) {
      res.status(400).json({
        error: "'data' must be a hex string starting with 0x",
        accepted_fields: ["data", "input", "calldata"],
      });
      return;
    }
    txData = rawData;
  }

  // Coerce gas to number (agents may send strings or numbers)
  let txGas: number | undefined;
  if (rawGas != null && rawGas !== "") {
    txGas = Number(rawGas);
    if (isNaN(txGas) || txGas < 0) {
      res.status(400).json({
        error: "'gas' must be a positive number",
        accepted_fields: ["gas", "gas_limit", "gasLimit"],
      });
      return;
    }
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const result = await simulateTransaction(networkId, fromAddr, toAddr, txValue, txData, txGas);
    upstreamStatus = 200;
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    const upstreamDetail = err.upstream ? JSON.stringify(err.upstream).slice(0, 500) : "";
    console.error(`[tx-simulate] upstream error: status=${upstreamStatus} message=${err.message} ${upstreamDetail}`);

    // If Tenderly returns 400, pass the error through (likely bad network_id or address)
    if (upstreamStatus === 400) {
      res.status(400).json({
        error: "Tenderly rejected the simulation request",
        detail: err.upstream?.error?.message || err.message,
      });
    } else {
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
    }
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
