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

    // Generate enriched 402 with asset/amount/extra fields
    console.log(`[enriched-402] Generating 402 for ${routeKey}`);
    console.log(`[enriched-402] First accept has asset?`, !!route.accepts[0]?.asset);
    console.log(`[enriched-402] First accept:`, JSON.stringify(route.accepts[0]));

    const paymentRequired = {
      x402Version: 2,
      error: "Payment required",
      resource: {
        url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        description: route.description || "API endpoint",
        mimeType: route.mimeType || "application/json",
      },
      accepts: route.accepts, // Contains asset, amount, maxTimeoutSeconds, extra
    };

    res.status(402)
      .setHeader("PAYMENT-REQUIRED", Buffer.from(JSON.stringify(paymentRequired)).toString("base64"))
      .setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED,PAYMENT-RESPONSE,X-Request-ID")
      .json({});
  };
}
