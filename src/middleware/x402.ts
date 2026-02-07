import type { Request, Response, NextFunction, RequestHandler } from "express";
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
 * Uses string-based arithmetic — no floating-point precision issues.
 */
function usdToUsdm(amount: number): string {
  // amount comes from the SDK as a number, convert to string carefully
  const str = amount.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
  return priceStringToTokenAmount(str, MEGAETH_CONFIG.stablecoin.decimals).toString();
}

export function createPaymentMiddleware(): RequestHandler {
  const facilitatorConfig = config.cdpApiKeyId && config.cdpApiKeySecret
    ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
    : { url: config.facilitatorUrl || "https://x402.org/facilitator" };
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

  // Cache routes at startup
  const routes = buildRoutesConfig();
  console.log("  Payment routes configured:", Object.keys(routes as Record<string, unknown>).join(", "));

  return paymentMiddleware(routes, server);
}

/**
 * Dev bypass middleware — only active in development mode.
 * Disabled entirely when NODE_ENV=production.
 */
export function devBypassMiddleware(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // SECURITY: dev bypass is completely disabled in production
    if (
      config.isDev &&
      config.devBypassSecret &&
      req.headers["x-dev-bypass"] === config.devBypassSecret
    ) {
      (req as any).devBypassed = true;
    }
    next();
  };
}
