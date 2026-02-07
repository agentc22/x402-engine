import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyMegaETHPayment, type PaymentProof } from "../verification/megaeth.js";
import { buildRoutesConfig, NETWORKS } from "../services/registry.js";
import { MEGAETH_CONFIG } from "../config/chains.js";
import { logRequest } from "../db/ledger.js";
import { priceStringToTokenAmount, truncateHash } from "../lib/validation.js";
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

// --- Route matching (cached) ---

let cachedRoutes: Record<string, any> | null = null;

function getRoutes(): Record<string, any> {
  if (!cachedRoutes) {
    cachedRoutes = buildRoutesConfig() as Record<string, any>;
  }
  return cachedRoutes;
}

/** Rebuild routes cache (call if services change). */
export function invalidateRoutesCache(): void {
  cachedRoutes = null;
}

function getRouteRequirements(
  method: string,
  path: string,
): { amount: string; payTo: string } | null {
  const routes = getRoutes();
  const routeKey = `${method.toUpperCase()} ${path.split("?")[0]}`;
  const route = routes[routeKey];
  if (!route) return null;

  const megaethAccept = route.accepts.find(
    (a: any) => a.network === NETWORKS.megaeth,
  );
  if (!megaethAccept) return null;

  return { amount: megaethAccept.price, payTo: megaethAccept.payTo };
}

// --- MegaETH direct payment middleware ---

export function megaethPaymentMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader =
      (req.headers["payment-signature"] as string) ||
      (req.headers["x-payment"] as string);

    if (!paymentHeader) {
      return next();
    }

    const decoded = decodePaymentHeader(paymentHeader);
    if (!decoded) return next();

    const network = detectNetwork(decoded);
    if (network !== "megaeth") {
      return next();
    }

    // --- MegaETH direct verification ---

    const start = Date.now();

    const routeReq = getRouteRequirements(req.method, req.path);
    if (!routeReq) {
      return next();
    }

    // String-based price conversion — no floating-point
    const expectedAmount = priceStringToTokenAmount(routeReq.amount, MEGAETH_CONFIG.stablecoin.decimals);
    const expectedRecipient = routeReq.payTo;

    const txHash = decoded.payload?.txHash as string | undefined;
    if (!txHash || !txHash.startsWith("0x")) {
      res.status(402).json({
        x402Version: 2,
        error: "MegaETH payments require a txHash in the payload",
      });
      return;
    }

    const proof: PaymentProof = { txHash: txHash as `0x${string}` };

    const result = await verifyMegaETHPayment(
      proof,
      expectedAmount,
      expectedRecipient,
    );

    const verifyMs = Date.now() - start;

    if (!result.valid) {
      console.log(`  MegaETH payment FAILED: ${result.error}, txHash=${truncateHash(txHash)} (${verifyMs}ms)`);
      res.status(402).json({
        x402Version: 2,
        error: "Payment verification failed",
        reason: result.error,
        network: NETWORKS.megaeth,
      });
      return;
    }

    // Payment verified — attach info, but log AFTER handler completes
    (req as any).x402 = {
      payer: result.payer,
      network: NETWORKS.megaeth,
      amount: expectedAmount.toString(),
      txHash: result.txHash,
      verificationMs: verifyMs,
      method: "direct",
    };

    console.log(`  MegaETH payment verified: ${truncateHash(result.txHash || "")} (${verifyMs}ms)`);

    // Intercept response to log actual status
    const originalEnd = res.end.bind(res);
    (res as any).end = function (...args: any[]) {
      logRequest({
        service: "megaeth-payment",
        endpoint: req.path,
        payer: result.payer,
        network: NETWORKS.megaeth,
        amount: expectedAmount.toString(),
        scheme: "exact",
        upstreamStatus: res.statusCode,
        latencyMs: Date.now() - start,
      });
      return originalEnd(...args);
    };

    next();
  };
}
