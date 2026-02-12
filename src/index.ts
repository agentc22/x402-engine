import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import type { Server } from "http";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { initDatabase, checkDatabase, getPoolStats, shutdownDatabase } from "./db/ledger.js";
import { getAllServices, getService, buildRoutesConfig } from "./services/registry.js";
import { MEGAETH_CONFIG, BASE_CONFIG, BASE_SEPOLIA_CONFIG } from "./config/chains.js";
import { createPaymentMiddleware, devBypassMiddleware } from "./middleware/x402.js";
import { megaethPaymentMiddleware } from "./middleware/payment.js";
import { enriched402Middleware } from "./middleware/payment-402.js";
import { requestTimeoutMiddleware } from "./middleware/timeout.js";
import { debugRoutes } from "./debug-routes.js";
import { freeEndpointLimiter, paidEndpointLimiter, expensiveEndpointLimiter } from "./middleware/rate-limit.js";
import imageRouter from "./apis/image.js";
import codeRouter from "./apis/code.js";
import transcribeRouter from "./apis/transcribe.js";
import cryptoRouter from "./apis/crypto.js";
import blockchainRouter from "./apis/blockchain.js";
import ipfsRouter from "./apis/ipfs.js";
import travelRouter from "./apis/travel.js";
import nftRouter from "./apis/nft.js";
import ensRouter from "./apis/ens.js";
import llmRouter from "./apis/llm.js";
import webRouter from "./apis/web.js";
import ttsRouter from "./apis/tts.js";
import txRouter from "./apis/tx.js";
import dashboardRouter from "./apis/dashboard.js";
import megaethFacilitator from "./facilitator/index.js";
import { initFal } from "./providers/fal.js";
import { initDeepgram } from "./providers/deepgram.js";
import { initIpfs } from "./providers/ipfs.js";
import { initAmadeus } from "./providers/amadeus.js";
import { checkMegaETHConnection } from "./verification/megaeth.js";
import { keyPool } from "./lib/key-pool.js";
import { mountMcp } from "./mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Trust the first proxy (Railway's reverse proxy) for correct client IP in rate limiting
app.set("trust proxy", 1);

// --- CORS (allow browser-based agents) ---
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-PAYMENT", "payment-signature", "X-DEV-BYPASS"],
  exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-Request-ID"],
}));

// --- Security headers ---
app.use((_req, res, next) => {
  res.setHeader("X-Request-ID", uuidv4());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// --- Global body limit: 1MB (route-specific overrides below) ---
app.use(express.json({ limit: "1mb" }));

// --- Request timeout middleware (30s hard limit) ---
app.use(requestTimeoutMiddleware());

// --- Static site (landing page + docs) ---
// Mounted after API routes to avoid unnecessary fs.stat on API requests
// (moved below, before paid routes)

// --- Free endpoints (before payment middleware) ---

app.get("/health", freeEndpointLimiter, (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/debug/routes", debugRoutes);

app.get("/health/deep", expensiveEndpointLimiter, async (req, res) => {
  // Require Authorization: Bearer <DASHBOARD_SECRET> for internal stats
  const authHeader = req.headers.authorization as string | undefined;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (
    !config.dashboardSecret || !token ||
    token.length !== config.dashboardSecret.length ||
    !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.dashboardSecret))
  ) {
    // Return basic health without internals
    const [dbOk, megaethOk] = await Promise.all([checkDatabase(), checkMegaETHConnection()]);
    const healthy = dbOk && megaethOk;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: { database: dbOk ? "ok" : "down", megaethRpc: megaethOk ? "ok" : "down" },
    });
    return;
  }

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
    pgPool: poolStats,
    keyPool: keyPool.stats(),
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
    categories[cat].push({ id: s.id, name: s.name, price: s.price, endpoint: `https://x402-gateway-production.up.railway.app${s.path}` });
  }

  return {
    name: "x402engine",
    version: "3.0.0",
    x402Version: 2,
    baseUrl: "https://x402-gateway-production.up.railway.app",
    important: "Always use the baseUrl above for API requests. The discovery endpoint may be served from a different domain (e.g. x402engine.app) but API calls must go to the baseUrl to avoid gateway errors.",
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
    mcp: {
      remote: "https://x402engine.app/mcp",
      npm: "x402engine-mcp",
      install: "npx -y x402engine-mcp",
      github: "https://github.com/agentc22/x402engine-mcp",
      claudeDesktop: {
        command: "npx",
        args: ["-y", "x402engine-mcp"],
      },
      claudeCode: "claude mcp add x402engine -- npx -y x402engine-mcp",
    },
    categories,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      endpoint: `https://x402-gateway-production.up.railway.app${s.path}`,
      method: s.method,
      category: s.category || "basic",
      parameters: s.parameters,
    })),
    routes,
  };
}

function buildServicesResponse() {
  const services = getAllServices();
  return {
    baseUrl: "https://x402-gateway-production.up.railway.app",
    count: services.length,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      endpoint: `https://x402-gateway-production.up.railway.app${s.path}`,
      method: s.method,
    })),
  };
}

app.get("/.well-known/x402.json", freeEndpointLimiter, (_req, res) => {
  res.json(discoveryResponse);
});

// A2A Agent Card — machine-readable agent discovery (Google A2A protocol)
app.get("/.well-known/agent.json", freeEndpointLimiter, (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/.well-known/agent.json"));
});

// llms.txt — LLM-readable service catalog
app.get("/llms.txt", freeEndpointLimiter, (_req, res) => {
  res.type("text/plain").sendFile(path.join(__dirname, "../public/llms.txt"));
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

// MCP endpoint (free, before payment middleware)
mountMcp(app);

// Dashboard (auth-protected, before payment middleware)
app.use(dashboardRouter);

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

// --- Extract payer metadata from payment header ---
// The x402 SDK middleware handles verification + settlement but does NOT
// attach payer/network/amount to req.x402.  We parse the payment header
// up-front so route handlers can log payment metadata regardless of which
// payment path was used (SDK vs MegaETH direct vs dev bypass).
app.use((req, _res, next) => {
  if ((req as any).devBypassed || (req as any).x402) {
    return next();
  }
  const header =
    (req.headers["payment-signature"] as string) ||
    (req.headers["x-payment"] as string);
  if (!header) return next();
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
    const network = decoded.accepted?.network;
    const amount = decoded.accepted?.amount;
    // EVM: authorization.from  or  permit2Authorization.from
    // SVM: payload may differ — fall back gracefully
    const payer =
      decoded.payload?.authorization?.from ??
      decoded.payload?.permit2Authorization?.from ??
      null;
    if (network) {
      (req as any).x402 = {
        payer,
        network,
        amount,
        method: "sdk",
      };
    }
  } catch {
    // Malformed header — let the SDK middleware handle the error
  }
  next();
});

// --- Enriched 402 Response Middleware (preserves asset/amount fields) ---
app.use(enriched402Middleware());

// --- x402 SDK Payment Middleware (Base + Solana verification only) ---
const paymentMw = createPaymentMiddleware();

app.use((req, res, next) => {
  if ((req as any).devBypassed || (req as any).x402?.method === "direct") {
    next();
  } else {
    // Express 4 doesn't catch async rejections — wrap SDK middleware
    Promise.resolve(paymentMw(req, res, next)).catch((err) => {
      console.error("[x402-sdk] Unhandled error in payment middleware:", err);
      next(err);
    });
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
app.use(travelRouter);
app.use(nftRouter);
app.use(ensRouter);
app.use(llmRouter);
app.use(webRouter);
app.use(ttsRouter);
app.use(txRouter);

// --- Global error handler (must be after all routes) ---
// Express 4 async middleware can throw unhandled rejections that hang requests.
// This catches them and returns a parseable JSON 503 instead of letting
// the request hang until Cloudflare times out with its own 502 HTML page.
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[global] Unhandled route error:", err?.message || err);
  if (!res.headersSent) {
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Internal error", retryable: true });
  }
});

// --- Start ---
let server: Server;

async function main() {
  console.log("Initializing x402engine...");
  console.log(`  Environment: ${config.nodeEnv}`);

  await initDatabase();
  console.log("  Database initialized (PostgreSQL, pool max=50)");

  // Register API key pools
  for (const [provider, keys] of Object.entries(config.keys)) {
    keyPool.register(provider, keys as string[]);
  }
  const poolStats = keyPool.stats();
  const poolSummary = Object.entries(poolStats)
    .map(([p, s]) => `${p}=${s.keys}`)
    .join(", ");
  console.log(`  Key pools: ${poolSummary || "none"}`);

  initFal();
  initDeepgram();
  initIpfs();
  initAmadeus();

  server = app.listen(config.port, () => {
    console.log(`\nx402engine running on http://localhost:${config.port}`);
    console.log(`  Health: http://localhost:${config.port}/health`);
    console.log(`  Deep health: http://localhost:${config.port}/health/deep`);
    console.log(`  Discovery: http://localhost:${config.port}/.well-known/x402.json`);
    console.log(`  Services: http://localhost:${config.port}/api/services`);
    if (config.isDev && config.devBypassSecret) {
      console.warn(`  ⚠️  DEV BYPASS ACTIVE — payments can be skipped with X-DEV-BYPASS header`);
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

// Prevent unhandled promise rejections from crashing the process
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
// Force rebuild Wed Feb 11 18:37:17 PST 2026
// Force rebuild Thu Feb 12 08:44:30 PST 2026
