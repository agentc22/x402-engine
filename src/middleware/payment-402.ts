import type { Request, Response, NextFunction, RequestHandler } from "express";
import { buildRoutesConfig } from "../services/registry.js";

/**
 * Custom 402 middleware - generates enriched payment requirements.
 * Runs BEFORE x402 SDK to preserve asset/amount/extra fields.
 */
export function enriched402Middleware(): RequestHandler {
  const routes = buildRoutesConfig();

  return (req: Request, res: Response, next: NextFunction) => {
    // Only intercept if no payment header present
    const hasPayment = req.headers["payment-signature"] || req.headers["x-payment"];
    if (hasPayment) {
      return next(); // Let SDK verify payment
    }

    // Check if route requires payment
    const routeKey = `${req.method} ${req.path.split("?")[0]}`;
    const route = (routes as Record<string, any>)[routeKey];

    if (!route) {
      return next(); // Not a paid route
    }

    // Generate enriched 402 with asset/amount/extra fields.
    // IMPORTANT: Strip `price` from accepts entries. The SDK's buildPaymentRequirements
    // doesn't include `price` in its output, so when the client echoes back the full
    // requirement as `accepted`, the deepEqual check in findMatchingRequirements would
    // fail if `price` is present in the client's copy but missing from the SDK's copy.
    const accepts = route.accepts.map((a: any) => {
      const { price, ...rest } = a;
      return rest;
    });

    console.log(`[enriched-402] Generating 402 for ${routeKey}`);

    const paymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        description: route.description || "API endpoint",
        mimeType: route.mimeType || "application/json",
      },
      accepts,
    };

    res.status(402)
      .setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"))
      .setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-Request-ID")
      .json({});
  };
}
