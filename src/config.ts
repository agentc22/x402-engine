import "dotenv/config";

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3402"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
  isDev: optional("NODE_ENV", "development") === "development",

  payToEvm: required("PAY_TO_EVM"),
  payToSolana: required("PAY_TO_SOLANA"),

  devBypassSecret: optional("DEV_BYPASS_SECRET", ""),
  facilitatorUrl: optional("FACILITATOR_URL", ""),
  cdpApiKeyId: optional("CDP_API_KEY_ID", ""),
  cdpApiKeySecret: optional("CDP_API_KEY_SECRET", ""),

  megaethRpc: optional("MEGAETH_RPC", "https://mainnet.megaeth.com/rpc"),
  megaethUsdmAddress: optional(
    "MEGAETH_USDM_ADDRESS",
    "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
  ),

  // Compute providers
  falApiKey: optional("FAL_API_KEY", ""),
  e2bApiKey: optional("E2B_API_KEY", ""),
  deepgramApiKey: optional("DEEPGRAM_API_KEY", ""),

  // Crypto data
  coingeckoApiKey: optional("COINGECKO_API_KEY", ""),

  // Blockchain data (Allium)
  alliumApiKey: optional("ALLIUM_API_KEY", ""),

  // IPFS storage
  pinataJwt: optional("PINATA_JWT", ""),
  pinataGateway: optional("PINATA_GATEWAY", "gateway.pinata.cloud"),

  // Compute provider settings
  computeProviders: {
    fal: {
      models: {
        fast: "fal-ai/flux/schnell",
        quality: "fal-ai/flux-2-pro",
        text: "fal-ai/ideogram/v3/turbo",
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
