import "dotenv/config";

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

/**
 * Read CSV-separated keys from env.
 * Supports both plural (COINGECKO_API_KEYS=k1,k2) and
 * singular fallback (COINGECKO_API_KEY=k1).
 */
function csvKeys(pluralKey: string, singularKey: string): string[] {
  const csv = process.env[pluralKey];
  if (csv) return csv.split(",").map((k) => k.trim()).filter(Boolean);
  const single = process.env[singularKey];
  if (single) return [single];
  return [];
}

export const config = {
  port: parseInt(optional("PORT", "3402"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  isDev: optional("NODE_ENV", "development") === "development",

  payToEvm: required("PAY_TO_EVM"),
  payToSolana: optional("PAY_TO_SOLANA", ""),

  devBypassSecret: optional("DEV_BYPASS_SECRET", ""),
  dashboardSecret: optional("DASHBOARD_SECRET", ""),
  facilitatorUrl: optional("FACILITATOR_URL", ""),
  cdpApiKeyId: optional("CDP_API_KEY_ID", ""),
  cdpApiKeySecret: optional("CDP_API_KEY_SECRET", ""),

  megaethRpc: optional("MEGAETH_RPC", "https://mainnet.megaeth.com/rpc"),
  megaethUsdmAddress: optional(
    "MEGAETH_USDM_ADDRESS",
    "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  ),

  // Provider API keys — support single key or CSV pool
  // Single: FAL_API_KEY=key1
  // Pool:   FAL_API_KEYS=key1,key2,key3
  keys: {
    fal: csvKeys("FAL_API_KEYS", "FAL_API_KEY"),
    e2b: csvKeys("E2B_API_KEYS", "E2B_API_KEY"),
    deepgram: csvKeys("DEEPGRAM_API_KEYS", "DEEPGRAM_API_KEY"),
    coingecko: csvKeys("COINGECKO_API_KEYS", "COINGECKO_API_KEY"),
    allium: csvKeys("ALLIUM_API_KEYS", "ALLIUM_API_KEY"),
    pinata: csvKeys("PINATA_JWTS", "PINATA_JWT"),
    amadeus: csvKeys("AMADEUS_API_KEYS", "AMADEUS_API_KEY"),
    amadeusSecret: csvKeys("AMADEUS_API_SECRETS", "AMADEUS_API_SECRET"),
  },

  // Keep singular accessors for backward compatibility (first key or empty)
  falApiKey: optional("FAL_API_KEY", ""),
  e2bApiKey: optional("E2B_API_KEY", ""),
  deepgramApiKey: optional("DEEPGRAM_API_KEY", ""),
  coingeckoApiKey: optional("COINGECKO_API_KEY", ""),
  alliumApiKey: optional("ALLIUM_API_KEY", ""),
  pinataJwt: optional("PINATA_JWT", ""),
  pinataGateway: optional("PINATA_GATEWAY", "gateway.pinata.cloud"),
  amadeusHostname: optional("AMADEUS_HOSTNAME", "production"),

  // Compute provider settings
  computeProviders: {
    fal: {
      models: {
        fast: "fal-ai/flux/schnell",
        quality: "fal-ai/flux-2-pro",
        text: "fal-ai/ideogram/v3",
      },
    },
    e2b: {
      defaultTimeout: 60,
      maxTimeout: 300,
    },
    deepgram: {
      model: "nova-3",
      fallbackModel: "whisper-large",
    },
  },
} as const;
