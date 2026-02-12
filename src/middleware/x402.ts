import type { Request, Response, NextFunction, RequestHandler } from "express";
import crypto from "crypto";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { config } from "../config.js";
import { buildRoutesConfig, NETWORKS } from "../services/registry.js";
import { MegaETHFacilitatorClient } from "../facilitator/index.js";
import { MEGAETH_CONFIG } from "../config/chains.js";
import { priceStringToTokenAmount } from "../lib/validation.js";

/**
 * Converts a decimal USD amount to USDm token units (18 decimals).
 * Rounds to 6 decimal places first to eliminate IEEE 754 float noise.
 * e.g. 0.03 in float is 0.02999999999999999889 — rounding to 6 dp gives "0.030000"
 * which then converts cleanly to 30000000000000000 via string arithmetic.
 */
function usdToUsdm(amount: number): string {
  // Round to 6 dp to kill float noise (our prices have at most 3 dp)
  const rounded = Math.round(amount * 1e6) / 1e6;
  const str = rounded.toFixed(6);
  return priceStringToTokenAmount(str, MEGAETH_CONFIG.stablecoin.decimals).toString();
}

export function createPaymentMiddleware(): RequestHandler {
  const useCdp = !!(config.cdpApiKeyId && config.cdpApiKeySecret);
  const facilitatorConfig = useCdp
    ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
    : { url: config.facilitatorUrl || "https://x402.org/facilitator" };
  console.log(`  Facilitator: ${useCdp ? "Coinbase CDP" : facilitatorConfig.url}`);
  const officialFacilitator = new HTTPFacilitatorClient(facilitatorConfig);
  const megaethFacilitator = new MegaETHFacilitatorClient();

  const server = new x402ResourceServer([officialFacilitator, megaethFacilitator]);

  const evmNetwork = config.isDev ? NETWORKS.baseSepolia : NETWORKS.base;
  server.register(evmNetwork, new ExactEvmScheme());

  const megaethScheme = new ExactEvmScheme();
  megaethScheme.registerMoneyParser(async (amount: number, network: string) => {
    if (network !== NETWORKS.megaeth) return null;
    return {
      amount: usdToUsdm(amount),
      asset: MEGAETH_CONFIG.stablecoin.address,
      extra: {
        name: MEGAETH_CONFIG.stablecoin.symbol,
        version: "2",
      },
    };
  });
  server.register(NETWORKS.megaeth, megaethScheme);

  const solNetwork = config.isDev ? NETWORKS.solanaDevnet : NETWORKS.solana;
  server.register(solNetwork, new ExactSvmScheme());

  // Cache routes at startup for logging
  const routes = buildRoutesConfig();
  console.log("  Payment routes configured:", Object.keys(routes as Record<string, unknown>).join(", "));

  // Don't pass routes to SDK - enriched402Middleware handles 402 generation
  // SDK is only used for payment verification
  return paymentMiddleware({}, server);
}

/**
 * Dev bypass middleware — only active in development mode.
 * Disabled entirely when NODE_ENV=production.
 */
export function devBypassMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // SECURITY: dev bypass is completely disabled in production
    const bypassHeader = req.headers["x-dev-bypass"] as string | undefined;
    if (
      config.isDev &&
      config.devBypassSecret &&
      bypassHeader &&
      bypassHeader.length === config.devBypassSecret.length &&
      crypto.timingSafeEqual(Buffer.from(bypassHeader), Buffer.from(config.devBypassSecret))
    ) {
      (req as any).devBypassed = true;
    }
    next();
  };
}
