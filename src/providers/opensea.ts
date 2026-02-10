import { keyPool } from "../lib/key-pool.js";

const OPENSEA_BASE = "https://api.opensea.io/api/v2";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openseaFetch(path: string): Promise<any> {
  const key = keyPool.acquire("opensea");
  if (!key) {
    throw Object.assign(new Error("OpenSea not configured"), { status: 502 });
  }

  const url = `${OPENSEA_BASE}${path}`;
  const headers: Record<string, string> = {
    "X-API-KEY": key,
    Accept: "application/json",
  };

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[opensea] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`OpenSea ${res.status}`), { status: res.status });
        continue;
      }

      if (res.status === 429 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error("OpenSea rate limited"), { status: 429 });
        continue;
      }

      const data = await res.json();
      if (!res.ok) {
        throw Object.assign(new Error(data.errors?.[0] || data.detail || "OpenSea API error"), {
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
  return openseaFetch(`/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contract)}/nfts/${encodeURIComponent(tokenId)}`);
}

export async function getNftOwnership(chain: string, contract: string, tokenId: string): Promise<any> {
  return openseaFetch(`/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contract)}/nfts/${encodeURIComponent(tokenId)}`);
}

export async function getCollection(chain: string, contract: string): Promise<any> {
  return openseaFetch(`/chain/${encodeURIComponent(chain)}/contract/${encodeURIComponent(contract)}`);
}
