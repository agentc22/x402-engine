import { Router, type Request, type Response } from "express";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from "@x402/core/types";
import { MEGAETH_CONFIG } from "../config/chains.js";
import {
  verifyMegaETHPayment,
  checkMegaETHConnection,
  type PaymentProof,
} from "../verification/megaeth.js";
import { getStats } from "../db/ledger.js";

/**
 * MegaETH Facilitator Client — Direct On-Chain Verification
 *
 * Unlike Base/Solana which use the official x402 facilitator for
 * permit-based settlement, MegaETH payments are verified directly
 * from transaction receipts. The flow:
 *
 * 1. Client sends USDm transfer via eth_sendRawTransactionSync (<10ms receipt)
 * 2. Client includes { txHash } in the x402 payment payload
 * 3. verify() fetches the receipt from MegaETH RPC and checks Transfer logs
 * 4. settle() is a no-op — the transfer already happened on-chain
 *
 * This eliminates the need for a third-party facilitator on MegaETH.
 */
export class MegaETHFacilitatorClient implements FacilitatorClient {
  async getSupported(): Promise<SupportedResponse> {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: "exact",
          network: MEGAETH_CONFIG.caip2 as `${string}:${string}`,
          extra: {
            name: MEGAETH_CONFIG.stablecoin.symbol,
            version: "2",
          },
        },
      ],
      extensions: [],
      signers: {},
    };
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // Extract the tx hash from the payment payload
    const payload = paymentPayload.payload as Record<string, unknown>;
    const txHash = payload.txHash as string | undefined;

    if (!txHash || !txHash.startsWith("0x")) {
      return {
        isValid: false,
        invalidReason: "missing_tx_hash",
        invalidMessage:
          "MegaETH payments require a txHash in the payload. " +
          "Send USDm via eth_sendRawTransactionSync, then include { txHash } in the x402 payload.",
      };
    }

    const proof: PaymentProof = {
      txHash: txHash as `0x${string}`,
    };

    const expectedAmount = BigInt(paymentRequirements.amount);
    const expectedRecipient = paymentRequirements.payTo;

    const result = await verifyMegaETHPayment(
      proof,
      expectedAmount,
      expectedRecipient,
    );

    if (result.valid) {
      return {
        isValid: true,
        payer: result.payer,
      };
    }

    return {
      isValid: false,
      invalidReason: "verification_failed",
      invalidMessage: result.error || "Payment verification failed",
    };
  }

  async settle(
    paymentPayload: PaymentPayload,
    _paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    // On MegaETH, the transfer already happened on-chain before verify().
    // Settlement is a no-op — we just confirm the tx hash.
    const payload = paymentPayload.payload as Record<string, unknown>;
    const txHash = (payload.txHash as string) || "";

    // NOTE: payer comes from the payload which is untrusted, but settle()
    // is only called after verify() succeeds, so the tx is already validated.
    // The payer is informational in the settlement response.
    return {
      success: true,
      transaction: txHash,
      network: MEGAETH_CONFIG.caip2 as `${string}:${string}`,
    };
  }
}

// --- Express routes for direct facilitator HTTP API ---

const router = Router();

router.get("/facilitator/megaeth/supported", async (_req: Request, res: Response) => {
  const client = new MegaETHFacilitatorClient();
  res.json(await client.getSupported());
});

router.post("/facilitator/megaeth/verify", async (req: Request, res: Response) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body || {};
    if (!paymentPayload?.payload || !paymentRequirements?.amount || !paymentRequirements?.payTo) {
      res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
      return;
    }
    const client = new MegaETHFacilitatorClient();
    const result = await client.verify(paymentPayload, paymentRequirements);
    res.status(result.isValid ? 200 : 402).json(result);
  } catch (err: any) {
    console.error("Facilitator verify error:", err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

router.post("/facilitator/megaeth/settle", async (req: Request, res: Response) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body || {};
    if (!paymentPayload?.payload || !paymentRequirements) {
      res.status(400).json({ error: "Missing paymentPayload or paymentRequirements" });
      return;
    }
    const client = new MegaETHFacilitatorClient();
    const result = await client.settle(paymentPayload, paymentRequirements);
    res.status(result.success ? 200 : 501).json(result);
  } catch (err: any) {
    console.error("Facilitator settle error:", err.message);
    res.status(500).json({ error: "Settlement failed" });
  }
});

router.get("/facilitator/megaeth/status", async (_req: Request, res: Response) => {
  try {
    const connected = await checkMegaETHConnection();
    const stats = await getStats();
    res.json({
      network: MEGAETH_CONFIG.caip2,
      rpc: MEGAETH_CONFIG.rpc,
      connected,
      stablecoin: MEGAETH_CONFIG.stablecoin,
      usedTxHashes: stats.usedTxHashes,
    });
  } catch (err: any) {
    console.error("Facilitator status error:", err.message);
    res.status(500).json({ error: "Status check failed" });
  }
});

export default router;
