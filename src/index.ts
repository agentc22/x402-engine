import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import type { Server } from "http";
import { config } from "./config.js";
import { initDatabase, checkDatabase, getPoolStats, shutdownDatabase } from "./db/ledger.js";
import { getAllServices, getService, buildRoutesConfig } from "./services/registry.js";
import { MEGAETH_CONFIG, BASE_CONFIG, BASE_SEPOLIA_CONFIG } from "./config/chains.js";
import { createPaymentMiddleware, devBypassMiddleware } from "./middleware/x402.js";
import { megaethPaymentMiddleware } from "./middleware/payment.js";
import { freeEndpointLimiter, paidEndpointLimiter, expensiveEndpointLimiter } from "./middleware/rate-limit.js";
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
import { checkMegaETHConnection } from "./verification/megaeth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// --- Global body limit: 1MB (route-specific overrides below) ---
app.use(express.json({ limit: "1mb" }));

// --- Static site (landing page + docs) ---
// Mounted after API routes to avoid unnecessary fs.stat on API requests
// (moved below, before paid routes)

// --- Free endpoints (before payment middleware) ---

app.get("/health", freeEndpointLimiter, (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/health/deep", expensiveEndpointLimiter, async (_req, res) => {
  const [dbOk, megaethOk] = await Promise.all([
    checkDatabase(),
    checkMegaETHConnection(),
  ]);
  const poolStats = getPoolStats();
  const memUsage = process.memoryUsage();

  const healthy = dbOk && megaethOk;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? "ok" : "down",
      megaethRpc: megaethOk ? "ok" : "down",
    },
    pool: poolStats,
    memory: {
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssMB: Math.round(memUsage.rss / 1024 / 1024),
    },
  });
});

// --- Discovery endpoints (cached at startup) ---

const discoveryResponse = buildDiscoveryResponse();
const servicesResponse = buildServicesResponse();

function buildDiscoveryResponse() {
  const services = getAllServices();
  const routes = buildRoutesConfig();
  const baseChain = config.isDev ? BASE_SEPOLIA_CONFIG : BASE_CONFIG;

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

function buildServicesResponse() {
  const services = getAllServices();
  return {
    count: services.length,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      endpoint: s.path,
      method: s.method,
    })),
  };
}

app.get("/.well-known/x402.json", freeEndpointLimiter, (_req, res) => {
  res.json(discoveryResponse);
});

app.get("/api/discover", freeEndpointLimiter, (_req, res) => {
  res.json(discoveryResponse);
});

app.get("/api/services", freeEndpointLimiter, (_req, res) => {
  res.json(servicesResponse);
});

app.get("/api/services/:id", freeEndpointLimiter, (req, res) => {
  const svc = getService(req.params.id as string);
  if (!svc) {
    res.status(404).json({ error: "Service not found" });
    return;
  }
  const routes = buildRoutesConfig() as Record<string, any>;
  const routeKey = `${svc.method} ${svc.path}`;
  res.json({
    ...svc,
    paymentOptions: routes[routeKey]?.accepts ?? [],
  });
});

// MegaETH facilitator routes (free, rate limited)
app.use("/facilitator/megaeth", expensiveEndpointLimiter);
app.use(megaethFacilitator);

// --- Static site (after free API routes, before payment middleware) ---
app.use(express.static(path.join(__dirname, "../public")));

// --- Rate limit on paid endpoints (secondary guard to payment requirement) ---
app.use(paidEndpointLimiter);

// --- Dev bypass middleware (must come before payment middleware) ---
app.use(devBypassMiddleware());

// --- MegaETH direct payment middleware ---
app.use(megaethPaymentMiddleware());

// --- x402 SDK Payment Middleware (Base + Solana) ---
const paymentMw = createPaymentMiddleware();

app.use((req, res, next) => {
  if ((req as any).devBypassed || (req as any).x402?.method === "direct") {
    next();
  } else {
    paymentMw(req, res, next);
  }
});

// --- Paid API routes (after payment middleware) ---
// Transcribe gets a larger body limit for audio_base64
app.use("/api/transcribe", express.json({ limit: "50mb" }), transcribeRouter);
app.use(imageRouter);
app.use(codeRouter);
app.use(cryptoRouter);
app.use(blockchainRouter);
app.use(ipfsRouter);

// --- Start ---
let server: Server;

async function main() {
  console.log("Initializing x402 Gateway...");
  console.log(`  Environment: ${config.nodeEnv}`);

  await initDatabase();
  console.log("  Database initialized (PostgreSQL, pool max=50)");

  initFal();
  initDeepgram();
  initIpfs();

  server = app.listen(config.port, () => {
    console.log(`\nx402 Gateway running on http://localhost:${config.port}`);
    console.log(`  Health: http://localhost:${config.port}/health`);
    console.log(`  Deep health: http://localhost:${config.port}/health/deep`);
    console.log(`  Discovery: http://localhost:${config.port}/.well-known/x402.json`);
    console.log(`  Services: http://localhost:${config.port}/api/services`);
    if (config.isDev) {
      console.log(`  Dev bypass: set X-DEV-BYPASS header to skip payments`);
    }
  });
}

// --- Graceful shutdown ---
async function shutdown(signal: string) {
  console.log(`\n${signal} received — shutting down gracefully...`);

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      console.log("  HTTP server closed");
    });
  }

  // Give in-flight requests 10 seconds to complete
  await new Promise((resolve) => setTimeout(resolve, 10_000));

  // Drain database pool
  try {
    await shutdownDatabase();
    console.log("  Database pool drained");
  } catch (err: any) {
    console.error("  Database shutdown error:", err.message);
  }

  console.log("  Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
