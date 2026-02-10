import { keyPool } from "../lib/key-pool.js";

// Chain name → Alchemy network prefix
const CHAIN_MAP: Record<string, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  zora: "zora-mainnet",
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getBaseUrl(chain: string): string {
  const network = CHAIN_MAP[chain];
  if (!network) {
    throw Object.assign(new Error(`Unsupported chain: ${chain}`), { status: 400 });
  }
  const key = keyPool.acquire("alchemy");
  if (!key) {
    throw Object.assign(new Error("Alchemy not configured"), { status: 502 });
  }
  return `https://${network}.g.alchemy.com/nft/v3/${key}`;
}

async function alchemyFetch(url: string): Promise<any> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[alchemy-nft] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`Alchemy ${res.status}`), { status: res.status });
        continue;
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error("Alchemy rate limited"), { status: 429 });
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.error || data.message || "Alchemy API error"), {
          status: res.status,
          upstream: data,
        });
      }
      return data;
    } catch (err: any) {
      if ((err.status >= 500 || err.status === 429 || err.name === "TimeoutError") && attempt < MAX_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}

export async function getNftMetadata(chain: string, contract: string, tokenId: string): Promise<any> {
  const base = getBaseUrl(chain);
  const params = new URLSearchParams({ contractAddress: contract, tokenId });
  return alchemyFetch(`${base}/getNFTMetadata?${params}`);
}

export async function getNftOwners(chain: string, contract: string, tokenId: string): Promise<any> {
  const base = getBaseUrl(chain);
  const params = new URLSearchParams({ contractAddress: contract, tokenId });
  return alchemyFetch(`${base}/getOwnersForNFT?${params}`);
}

export async function getContractMetadata(chain: string, contract: string): Promise<any> {
  const base = getBaseUrl(chain);
  const params = new URLSearchParams({ contractAddress: contract });
  return alchemyFetch(`${base}/getContractMetadata?${params}`);
}
