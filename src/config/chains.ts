export interface ChainConfig {
  chainId: number;
  name: string;
  displayName: string;
  caip2: string;
  rpc: string;
  ws?: string;
  explorer: string;
  blockTime: number;
  stablecoin: {
    symbol: string;
    address: string;
    decimals: number;
  };
  features: {
    realtimeApi: boolean;
    instantReceipts: boolean;
    miniBlocks: boolean;
  };
}

export const MEGAETH_CONFIG: ChainConfig = {
  chainId: 4326,
  name: "megaeth",
  displayName: "MegaETH",
  caip2: "eip155:4326",
  rpc: process.env.MEGAETH_RPC || "https://mainnet.megaeth.com/rpc",
  ws: "wss://mainnet.megaeth.com/ws",
  explorer: "https://megaeth.blockscout.com",
  blockTime: 10,
  stablecoin: {
    symbol: "USDm",
    address: process.env.MEGAETH_USDM_ADDRESS || "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
    decimals: 18,
  },
  features: {
    realtimeApi: true,
    instantReceipts: true,
    miniBlocks: true,
  },
};

export const BASE_CONFIG: ChainConfig = {
  chainId: 8453,
  name: "base",
  displayName: "Base",
  caip2: "eip155:8453",
  rpc: "https://mainnet.base.org",
  explorer: "https://basescan.org",
  blockTime: 2000,
  stablecoin: {
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  features: {
    realtimeApi: false,
    instantReceipts: false,
    miniBlocks: false,
  },
};

export const BASE_SEPOLIA_CONFIG: ChainConfig = {
  chainId: 84532,
  name: "baseSepolia",
  displayName: "Base Sepolia",
  caip2: "eip155:84532",
  rpc: "https://sepolia.base.org",
  explorer: "https://sepolia.basescan.org",
  blockTime: 2000,
  stablecoin: {
    symbol: "USDC",
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    decimals: 6,
  },
  features: {
    realtimeApi: false,
    instantReceipts: false,
    miniBlocks: false,
  },
};

export const CHAINS = {
  megaeth: MEGAETH_CONFIG,
  base: BASE_CONFIG,
  baseSepolia: BASE_SEPOLIA_CONFIG,
} as const;
