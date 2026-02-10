import { Router, type Request, type Response } from "express";
import { getNftMetadata, getNftOwnership, getCollection } from "../providers/opensea.js";
import { logRequest } from "../db/ledger.js";
import { isValidEthAddress, isValidChain } from "../lib/validation.js";
import { TTLCache } from "../lib/cache.js";

const router = Router();

// 5-minute TTL cache for NFT data
const cache = new TTLCache<any>(300_000);

const VALID_CHAINS = new Set([
  "ethereum", "base", "polygon", "arbitrum", "optimism", "avalanche",
  "bsc", "zora", "blast", "sei", "abstract",
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
    res.status(400).json({ error: "Provide valid 'chain' (ethereum, base, polygon, etc)" });
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
    const nft = raw.nft || raw;
    const result = {
      name: nft.name,
      description: nft.description,
      image: nft.image_url || nft.display_image_url,
      traits: nft.traits,
      collection: nft.collection,
      token_standard: nft.token_standard,
      contract: nft.contract,
      identifier: nft.identifier,
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
    res.status(400).json({ error: "Provide valid 'chain' (ethereum, base, polygon, etc)" });
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
    const raw = await getNftOwnership(chain, contract, tokenId);
    upstreamStatus = 200;
    const nft = raw.nft || raw;
    const result = {
      owner: nft.owners?.[0]?.address || nft.owner,
      token_standard: nft.token_standard,
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
    res.status(400).json({ error: "Provide valid 'chain' (ethereum, base, polygon, etc)" });
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
    const raw = await getCollection(chain, contract);
    upstreamStatus = 200;
    const result = {
      name: raw.name,
      description: raw.description,
      image: raw.image_url,
      collection: raw.collection,
      owner: raw.owner,
      total_supply: raw.total_supply,
      contracts: raw.contracts,
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
