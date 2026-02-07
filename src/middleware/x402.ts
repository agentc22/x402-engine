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

/**
 * Converts a decimal USD amount to USDm token units (18 decimals).
 * e.g. 0.001 -> "1000000000000000" (10^15)
 */
function usdToUsdm(amount: number): string {
  const decimals = MEGAETH_CONFIG.stablecoin.decimals; // 18
  const [intPart, decPart = ""] = String(amount).split(".");
  const padded = decPart.padEnd(decimals, "0").slice(0, decimals);
  return (intPart + padded).replace(/^0+/, "") || "0";
}

/**
 * Creates the @x402/express SDK payment middleware.
 *
 * This handles Base and Solana payments via the official facilitator.
 * MegaETH payments are intercepted upstream by megaethPaymentMiddleware
 * (in payment.ts) before reaching this middleware.
 *
 * MegaETH is still registered here so the SDK includes it in 402
 * payment requirement responses — but the MegaETHFacilitatorClient
 * also serves as a fallback if a MegaETH payment somehow reaches
 * the SDK middleware.
 */
export function createPaymentMiddleware(): RequestHandler {
  // Use Coinbase CDP facilitator (with auth) if CDP keys are set, otherwise fall back to URL
  const facilitatorConfig = config.cdpApiKeyId && config.cdpApiKeySecret
    ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
    : { url: config.facilitatorUrl || "https://x402.org/facilitator" };
  const officialFacilitator = new HTTPFacilitatorClient(facilitatorConfig);
  const megaethFacilitator = new MegaETHFacilitatorClient();

  // Both facilitators: official for Base/Solana, megaeth for eip155:4326
  const server = new x402ResourceServer([officialFacilitator, megaethFacilitator]);

  // Register EVM scheme for Base (or Base Sepolia in dev)
  const evmNetwork = config.isDev ? NETWORKS.baseSepolia : NETWORKS.base;
  server.register(evmNetwork, new ExactEvmScheme());

  // Register EVM scheme for MegaETH with custom money parser for USDm (18 decimals)
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

  // Register SVM scheme for Solana (dev only — no mainnet facilitator yet)
  if (config.isDev) {
    server.register(NETWORKS.solanaDevnet, new ExactSvmScheme());
  }

  const routes = buildRoutesConfig();
  console.log("  Payment routes configured:", Object.keys(routes as Record<string, unknown>).join(", "));

  return paymentMiddleware(routes, server);
}

export function devBypassMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
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
