import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { RoutesConfig } from "@x402/core/server";
import { config } from "../config.js";
import { MEGAETH_CONFIG } from "../config/chains.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ServiceUpstream {
  provider: string;
  baseUrl: string;
  keyParam?: string;
  keyHeader?: string;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  price: string;
  method: string;
  path: string;
  mimeType: string;
  category?: string;
  upstream: ServiceUpstream;
}

interface ServicesFile {
  services: ServiceDefinition[];
}

const servicesPath = path.resolve(__dirname, "../../config/services.json");
const raw = readFileSync(servicesPath, "utf-8");
const { services } = JSON.parse(raw) as ServicesFile;

export function getAllServices(): ServiceDefinition[] {
  return services;
}

export function getService(id: string): ServiceDefinition | undefined {
  return services.find((s) => s.id === id);
}

// Networks we support
const NETWORKS = {
  base: "eip155:8453" as const,
  baseSepolia: "eip155:84532" as const,
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const,
  solanaDevnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const,
  megaeth: "eip155:4326" as const,
};

export function buildRoutesConfig(): RoutesConfig {
  const routes: Record<string, { accepts: { scheme: string; price: string; network: string; payTo: string }[]; description: string; mimeType: string }> = {};
  const isDev = config.isDev;

  for (const svc of services) {
    const routeKey = `${svc.method} ${svc.path}`;
    const accepts: { scheme: string; price: string; network: string; payTo: string }[] = [];

    // Base (or Base Sepolia in dev)
    if (config.payToEvm) {
      const evmNetwork = isDev ? NETWORKS.baseSepolia : NETWORKS.base;
      accepts.push({
        scheme: "exact",
        price: svc.price,
        network: evmNetwork,
        payTo: config.payToEvm,
      });

      // MegaETH — uses same EVM payTo address, custom facilitator handles it
      accepts.push({
        scheme: "exact",
        price: svc.price,
        network: NETWORKS.megaeth,
        payTo: config.payToEvm,
      });
    }

    // Solana
    if (config.payToSolana) {
      const solNetwork = isDev ? NETWORKS.solanaDevnet : NETWORKS.solana;
      accepts.push({
        scheme: "exact",
        price: svc.price,
        network: solNetwork,
        payTo: config.payToSolana,
      });
    }

    routes[routeKey] = {
      accepts,
      description: svc.description,
      mimeType: svc.mimeType,
    };
  }

  return routes as RoutesConfig;
}

export function getMegaEthInfo() {
  return {
    network: NETWORKS.megaeth,
    chainId: MEGAETH_CONFIG.chainId,
    rpc: MEGAETH_CONFIG.rpc,
    explorer: MEGAETH_CONFIG.explorer,
    stablecoin: MEGAETH_CONFIG.stablecoin,
    features: MEGAETH_CONFIG.features,
    status: "active",
  };
}

export { NETWORKS };
