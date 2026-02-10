import { Router, type Request, type Response } from "express";
import { getNftMetadata, getNftOwners, getContractMetadata } from "../providers/alchemy-nft.js";
import { logRequest } from "../db/ledger.js";
import { isValidEthAddress } from "../lib/validation.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

// 5-minute TTL cache for NFT data
const cache = new TTLCache<any>(300_000);

// Chains supported by Alchemy NFT API
const VALID_CHAINS = new Set([
  "ethereum", "base", "polygon", "arbitrum", "optimism", "zora",
]);

function validateChain(chain: string | undefined): string | null {
  if (!chain) return null;
  const lower = chain.toLowerCase();
  if (!VALID_CHAINS.has(lower)) return null;
  return lower;
}

function validateContract(contract: string | undefined): boolean {
  return !!contract && isValidEthAddress(contract);
}

function validateTokenId(tokenId: string | undefined): boolean {
  return !!tokenId && /^\d{1,78}$/.test(tokenId);
}

router.get("/api/nft/metadata", async (req: Request, res: Response) => {
  const chain = validateChain(req.query.chain as string);
  if (!chain) {
    res.status(400).json({ error: "Provide valid 'chain' (ethereum, base, polygon, arbitrum, optimism, zora)" });
    return;
  }
  const contract = req.query.contract as string;
  if (!validateContract(contract)) {
    res.status(400).json({ error: "Provide valid 'contract' address (0x...)" });
    return;
  }
  const tokenId = req.query.tokenId as string;
  if (!validateTokenId(tokenId)) {
    res.status(400).json({ error: "Provide valid 'tokenId' (numeric)" });
    return;
  }

  const cacheKey = `nft:meta:${chain}:${contract}:${tokenId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const raw = await getNftMetadata(chain, contract, tokenId);
    upstreamStatus = 200;
    const result = {
      name: raw.name || raw.title,
      description: raw.description,
      image: raw.image?.cachedUrl || raw.image?.originalUrl || raw.image?.pngUrl,
      traits: raw.raw?.metadata?.attributes || [],
      collection: raw.collection,
      token_standard: raw.tokenType,
      contract: raw.contract?.address || contract,
      identifier: raw.tokenId || tokenId,
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[nft-metadata] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "nft-metadata",
      endpoint: "/api/nft/metadata",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/nft/ownership", async (req: Request, res: Response) => {
  const chain = validateChain(req.query.chain as string);
  if (!chain) {
    res.status(400).json({ error: "Provide valid 'chain' (ethereum, base, polygon, arbitrum, optimism, zora)" });
    return;
  }
  const contract = req.query.contract as string;
  if (!validateContract(contract)) {
    res.status(400).json({ error: "Provide valid 'contract' address (0x...)" });
    return;
  }
  const tokenId = req.query.tokenId as string;
  if (!validateTokenId(tokenId)) {
    res.status(400).json({ error: "Provide valid 'tokenId' (numeric)" });
    return;
  }

  const cacheKey = `nft:owner:${chain}:${contract}:${tokenId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const raw = await getNftOwners(chain, contract, tokenId);
    upstreamStatus = 200;
    const result = {
      owners: raw.owners || [],
      contract: contract,
      tokenId: tokenId,
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[nft-ownership] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "nft-ownership",
      endpoint: "/api/nft/ownership",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

router.get("/api/nft/collection", async (req: Request, res: Response) => {
  const chain = validateChain(req.query.chain as string);
  if (!chain) {
    res.status(400).json({ error: "Provide valid 'chain' (ethereum, base, polygon, arbitrum, optimism, zora)" });
    return;
  }
  const contract = req.query.contract as string;
  if (!validateContract(contract)) {
    res.status(400).json({ error: "Provide valid 'contract' address (0x...)" });
    return;
  }

  const cacheKey = `nft:collection:${chain}:${contract}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const start = Date.now();
  let upstreamStatus = 0;

  try {
    const raw = await getContractMetadata(chain, contract);
    upstreamStatus = 200;
    const result = {
      name: raw.name,
      symbol: raw.symbol,
      description: raw.openSeaMetadata?.description || null,
      image: raw.openSeaMetadata?.imageUrl || null,
      token_type: raw.tokenType,
      total_supply: raw.totalSupply,
      floor_price: raw.openSeaMetadata?.floorPrice || null,
      deployed_by: raw.contractDeployer,
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err: any) {
    upstreamStatus = err.status || 500;
    console.error(`[nft-collection] upstream error: status=${upstreamStatus} message=${err.message}`);
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Upstream temporarily unavailable", retryable: true, upstreamStatus });
  } finally {
    logRequest({
      service: "nft-collection",
      endpoint: "/api/nft/collection",
      payer: (req as any).x402?.payer,
      network: (req as any).x402?.network,
      amount: (req as any).x402?.amount,
      upstreamStatus,
      latencyMs: Date.now() - start,
    });
  }
});

export default router;
