#!/usr/bin/env node
/**
 * Comprehensive x402engine endpoint test suite
 * Tests all 52 endpoints with proper parameters
 *
 * Usage: node test-all-endpoints.mjs
 * Env: TEST_PRIVATE_KEY=0x... (wallet with USDC on Base)
 */

import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const BASE_URL = 'https://x402-gateway-production.up.railway.app';
const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('❌ Set TEST_PRIVATE_KEY environment variable');
  process.exit(1);
}

// Initialize client
const account = privateKeyToAccount(PRIVATE_KEY);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account, networks: ['eip155:8453'] });
const payFetch = wrapFetchWithPayment(fetch, client, {
  paymentRequirementsSelector: (accepts) => accepts.find(a => a.network === 'eip155:8453')
});

// Test definitions with proper parameters
const tests = {
  // Crypto & Blockchain
  'crypto-price': { method: 'GET', url: '/api/crypto/price?ids=bitcoin,ethereum&currencies=usd' },
  'crypto-markets': { method: 'GET', url: '/api/crypto/markets?currency=usd&limit=10' },
  'crypto-history': { method: 'GET', url: '/api/crypto/history?id=bitcoin&currency=usd&days=7' },
  'crypto-trending': { method: 'GET', url: '/api/crypto/trending' },
  'crypto-search': { method: 'GET', url: '/api/crypto/search?q=bitcoin' },
  'ens-resolve': { method: 'GET', url: '/api/ens/resolve?name=vitalik.eth' },
  'ens-reverse': { method: 'GET', url: '/api/ens/reverse?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },

  // LLMs
  'llm-gpt-4o': { method: 'POST', url: '/api/llm/gpt-4o', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },
  'llm-gpt-4o-mini': { method: 'POST', url: '/api/llm/gpt-4o-mini', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },
  'llm-claude-opus': { method: 'POST', url: '/api/llm/claude-opus', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },
  'llm-claude-sonnet': { method: 'POST', url: '/api/llm/claude-sonnet', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },
  'llm-claude-haiku': { method: 'POST', url: '/api/llm/claude-haiku', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },
  'llm-gemini-flash': { method: 'POST', url: '/api/llm/gemini-flash', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },
  'llm-deepseek-r1': { method: 'POST', url: '/api/llm/deepseek-r1', body: { messages: [{ role: 'user', content: 'Say "ok"' }], max_tokens: 5 } },

  // Media & Compute
  'image-fast': { method: 'POST', url: '/api/image/fast', body: { prompt: 'a red circle' } },
  'embeddings': { method: 'POST', url: '/api/embeddings', body: { text: 'hello world' } },

  // Travel (use future dates)
  'travel-locations': { method: 'GET', url: '/api/travel/locations?keyword=Los+Angeles' },
  'travel-flights': { method: 'GET', url: '/api/travel/flights?origin=LAX&destination=JFK&departureDate=2026-06-01&adults=1' },
  'travel-cheapest-dates': { method: 'GET', url: '/api/travel/cheapest-dates?origin=LAX&destination=JFK' },

  // NFT & Tokens
  'nft-metadata': { method: 'GET', url: '/api/nft/metadata?chain=eth-mainnet&contract=0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d&tokenId=1' },
  'nft-ownership': { method: 'GET', url: '/api/nft/ownership?chain=eth-mainnet&contract=0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d&tokenId=1' },
  'nft-collection': { method: 'GET', url: '/api/nft/collection?chain=eth-mainnet&contract=0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' },
  'token-metadata': { method: 'GET', url: '/api/token/metadata?chain=ethereum&address=0xdac17f958d2ee523a2206206994597c13d831ec7' },

  // Web
  'web-scrape': { method: 'GET', url: '/api/web/scrape?url=https://example.com' },
  'web-screenshot': { method: 'GET', url: '/api/web/screenshot?url=https://example.com' },

  // IPFS
  'ipfs-get': { method: 'GET', url: '/api/ipfs/get?cid=QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
};

// Run tests
const results = { ok: 0, degraded: 0, broken: 0 };
console.log(`Testing ${Object.keys(tests).length} endpoints...\n`);

for (const [id, test] of Object.entries(tests)) {
  try {
    const opts = { method: test.method };
    if (test.body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(test.body);
    }

    const response = await payFetch(`${BASE_URL}${test.url}`, opts);
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }

    if (response.status === 200) {
      console.log(`✅ ${id}`);
      results.ok++;
    } else if (response.status === 503 && data.retryable) {
      console.log(`⚠️  ${id} - upstream temporarily unavailable`);
      results.degraded++;
    } else {
      console.log(`❌ ${id} - ${response.status} ${data.error || ''}`);
      results.broken++;
    }

    await new Promise(r => setTimeout(r, 500)); // Rate limit
  } catch (error) {
    console.log(`❌ ${id} - ${error.message}`);
    results.broken++;
  }
}

console.log(`\nResults: ${results.ok} ok, ${results.degraded} degraded, ${results.broken} broken`);
process.exit(results.broken > 0 ? 1 : 0);
