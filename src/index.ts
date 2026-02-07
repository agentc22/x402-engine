import express from "express";
import { config } from "./config.js";
import { initDatabase } from "./db/ledger.js";
import { getAllServices, getService, buildRoutesConfig } from "./services/registry.js";
import { MEGAETH_CONFIG, BASE_CONFIG, BASE_SEPOLIA_CONFIG } from "./config/chains.js";
import { createPaymentMiddleware, devBypassMiddleware } from "./middleware/x402.js";
import { megaethPaymentMiddleware } from "./middleware/payment.js";
import imageRouter from "./apis/image.js";
import codeRouter from "./apis/code.js";
import transcribeRouter from "./apis/transcribe.js";
import cryptoRouter from "./apis/crypto.js";
import blockchainRouter from "./apis/blockchain.js";
import ipfsRouter from "./apis/ipfs.js";
import megaethFacilitator from "./facilitator/index.js";
import { initFal } from "./providers/fal.js";
import { initDeepgram } from "./providers/deepgram.js";
import { initIpfs } from "./providers/ipfs.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

// --- Phase 6: Free endpoints (before payment middleware) ---

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

function buildDiscoveryResponse() {
  const services = getAllServices();
  const routes = buildRoutesConfig();
  const baseChain = config.isDev ? BASE_SEPOLIA_CONFIG : BASE_CONFIG;

  // Group services by category
  const categories: Record<string, { id: string; name: string; price: string; endpoint: string }[]> = {};
  for (const s of services) {
    const cat = s.category || "basic";
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ id: s.id, name: s.name, price: s.price, endpoint: s.path });
  }

  return {
    name: "x402 Gateway",
    version: "3.0.0",
    x402Version: 2,
    networks: {
      base: {
        chainId: baseChain.chainId,
        caip2: baseChain.caip2,
        stablecoin: baseChain.stablecoin.symbol,
        decimals: baseChain.stablecoin.decimals,
        estimatedConfirmation: "2s",
      },
      solana: {
        stablecoin: "USDC",
        decimals: 6,
        estimatedConfirmation: "400ms",
      },
      megaeth: {
        chainId: MEGAETH_CONFIG.chainId,
        caip2: MEGAETH_CONFIG.caip2,
        stablecoin: MEGAETH_CONFIG.stablecoin.symbol,
        decimals: MEGAETH_CONFIG.stablecoin.decimals,
        estimatedConfirmation: "10ms",
        features: ["instant-receipts", "realtime-api"],
      },
    },
    hint: "MegaETH (eip155:4326) offers ~10ms confirmation — the fastest option for latency-sensitive agents. Payments use USDm (18 decimals) and are verified on-chain instantly via eth_sendRawTransactionSync.",
    categories,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      endpoint: s.path,
      method: s.method,
      category: s.category || "basic",
    })),
    routes,
  };
}

app.get("/.well-known/x402.json", (_req, res) => {
  res.json(buildDiscoveryResponse());
});

app.get("/api/discover", (_req, res) => {
  res.json(buildDiscoveryResponse());
});

app.get("/api/services", (_req, res) => {
  const services = getAllServices();
  res.json({
    count: services.length,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      endpoint: s.path,
      method: s.method,
    })),
  });
});

app.get("/api/services/:id", (req, res) => {
  const svc = getService(req.params.id);
  if (!svc) {
    res.status(404).json({ error: `Service '${req.params.id}' not found` });
    return;
  }
  const routes = buildRoutesConfig() as Record<string, any>;
  const routeKey = `${svc.method} ${svc.path}`;
  res.json({
    ...svc,
    paymentOptions: routes[routeKey]?.accepts ?? [],
  });
});

// Free informational endpoints removed (Alchemy RPC replaced by Allium)

// MegaETH facilitator stub (free)
app.use(megaethFacilitator);

// --- Dev bypass middleware (must come before payment middleware) ---
app.use(devBypassMiddleware());

// --- MegaETH direct payment middleware ---
// Intercepts payments for eip155:4326 and verifies USDm transfers
// on-chain. No facilitator, no settlement step, no response buffering.
// Non-MegaETH payments pass through to the SDK middleware below.
app.use(megaethPaymentMiddleware());

// --- x402 SDK Payment Middleware (Base + Solana) ---
// Handles permit-based payment flows via the official facilitator.
// MegaETH payments are already handled above — this is the fallback.
const paymentMw = createPaymentMiddleware();

app.use((req, res, next) => {
  if ((req as any).devBypassed || (req as any).x402?.method === "direct") {
    // Skip SDK middleware: dev bypass or already verified by MegaETH middleware
    next();
  } else {
    paymentMw(req, res, next);
  }
});

// --- Paid API routes (after payment middleware) ---
app.use(imageRouter);
app.use(codeRouter);
app.use(transcribeRouter);
app.use(cryptoRouter);
app.use(blockchainRouter);
app.use(ipfsRouter);

// --- Start ---
async function main() {
  console.log("Initializing x402 Gateway...");
  console.log(`  Environment: ${config.nodeEnv}`);

  initDatabase();
  console.log("  Database initialized");


  initFal();
  initDeepgram();
  initIpfs();

  app.listen(config.port, () => {
    console.log(`\nx402 Gateway running on http://localhost:${config.port}`);
    console.log(`  Health: http://localhost:${config.port}/health`);
    console.log(`  Discovery: http://localhost:${config.port}/.well-known/x402.json`);
    console.log(`  Services: http://localhost:${config.port}/api/services`);
    if (config.isDev) {
      console.log(`  Dev bypass: set X-DEV-BYPASS header to skip payments`);
    }
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
