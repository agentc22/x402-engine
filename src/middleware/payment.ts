import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyMegaETHPayment, type PaymentProof } from "../verification/megaeth.js";
import { buildRoutesConfig, NETWORKS } from "../services/registry.js";
import { MEGAETH_CONFIG } from "../config/chains.js";
import { logRequest } from "../db/ledger.js";
import type { RoutesConfig } from "@x402/core/server";

// --- Payment header parsing ---

interface DecodedPayment {
  x402Version: number;
  accepted: {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
  };
  payload: Record<string, unknown>;
}

function decodePaymentHeader(header: string): DecodedPayment | null {
  try {
    const json = Buffer.from(header, "base64").toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// --- Network detection ---

type PaymentNetwork = "megaeth" | "base" | "solana" | "unknown";

function detectNetwork(decoded: DecodedPayment): PaymentNetwork {
  const network = decoded.accepted?.network;
  if (!network) return "unknown";

  if (network === NETWORKS.megaeth) return "megaeth";
  if (network === NETWORKS.base || network === NETWORKS.baseSepolia) return "base";
  if (network === NETWORKS.solana || network === NETWORKS.solanaDevnet) return "solana";

  return "unknown";
}

// --- Route matching ---

/** Check if a request path + method matches a paid route in the routes config. */
function getRouteRequirements(
  method: string,
  path: string,
): { amount: string; payTo: string } | null {
  const routes = buildRoutesConfig() as Record<string, any>;
  const routeKey = `${method.toUpperCase()} ${path.split("?")[0]}`;
  const route = routes[routeKey];
  if (!route) return null;

  // Find the MegaETH accept option
  const megaethAccept = route.accepts.find(
    (a: any) => a.network === NETWORKS.megaeth,
  );
  if (!megaethAccept) return null;

  return { amount: megaethAccept.price, payTo: megaethAccept.payTo };
}

// --- USD to USDm conversion (mirrors the money parser in x402.ts) ---

function priceToUsdmAmount(price: string): bigint {
  // price is "$0.001" format — strip the dollar sign and parse
  const stripped = price.startsWith("$") ? price.slice(1) : price;
  const decimal = parseFloat(stripped);
  const decimals = MEGAETH_CONFIG.stablecoin.decimals; // 18
  const [intPart, decPart = ""] = String(decimal).split(".");
  const padded = decPart.padEnd(decimals, "0").slice(0, decimals);
  const tokenStr = (intPart + padded).replace(/^0+/, "") || "0";
  return BigInt(tokenStr);
}

// --- MegaETH direct payment middleware ---

/**
 * Intercepts requests that carry a MegaETH payment proof in the
 * `payment-signature` header. Verifies the USDm transfer on-chain
 * and lets the request through if valid.
 *
 * Non-MegaETH payments (or requests without payment headers) pass
 * through to the next middleware (the SDK payment middleware).
 *
 * Why a separate middleware?
 * - MegaETH transfers happen BEFORE the request (client sends USDm,
 *   gets instant receipt, then sends the request with txHash proof).
 * - The SDK middleware assumes verify → run handler → settle.
 *   That settlement step is unnecessary for MegaETH, and the response
 *   buffering adds latency we don't need on a 10ms chain.
 */
export function megaethPaymentMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Check for payment header (SDK uses these header names)
    const paymentHeader =
      (req.headers["payment-signature"] as string) ||
      (req.headers["x-payment"] as string);

    if (!paymentHeader) {
      // No payment header — fall through to SDK middleware
      return next();
    }

    // Decode and check if this is a MegaETH payment
    const decoded = decodePaymentHeader(paymentHeader);
    if (!decoded) return next();

    const network = detectNetwork(decoded);
    if (network !== "megaeth") {
      // Not MegaETH — let SDK middleware handle Base/Solana
      return next();
    }

    // --- MegaETH direct verification ---

    const start = Date.now();

    // Get the expected amount for this route
    const routeReq = getRouteRequirements(req.method, req.path);
    if (!routeReq) {
      // Not a paid route — shouldn't happen, but pass through
      return next();
    }

    const expectedAmount = priceToUsdmAmount(routeReq.amount);
    const expectedRecipient = routeReq.payTo;

    // Extract tx hash from payment payload
    const txHash = decoded.payload?.txHash as string | undefined;
    if (!txHash || !txHash.startsWith("0x")) {
      res.status(402).json({
        x402Version: 2,
        error: "MegaETH payments require a txHash in the payload",
        hint: "Send USDm via eth_sendRawTransactionSync, include { txHash } in x402 payload",
      });
      return;
    }

    const proof: PaymentProof = { txHash: txHash as `0x${string}` };

    const result = await verifyMegaETHPayment(
      proof,
      expectedAmount,
      expectedRecipient,
    );

    const latencyMs = Date.now() - start;

    if (!result.valid) {
      res.status(402).json({
        x402Version: 2,
        error: "Payment verification failed",
        reason: result.error,
        network: NETWORKS.megaeth,
      });
      return;
    }

    // Payment verified — attach payment info to request for handlers/logging
    (req as any).x402 = {
      payer: result.payer,
      network: NETWORKS.megaeth,
      amount: expectedAmount.toString(),
      txHash: result.txHash,
      verificationMs: latencyMs,
      method: "direct",
    };

    logRequest({
      service: "megaeth-payment",
      endpoint: req.path,
      payer: result.payer,
      network: NETWORKS.megaeth,
      amount: expectedAmount.toString(),
      scheme: "exact",
      upstreamStatus: 200,
      latencyMs,
    });

    console.log(
      `  MegaETH payment verified: ${result.txHash} (${latencyMs}ms)`,
    );

    // Let the request through to the API handler — no settlement needed
    next();
  };
}
