# x402 Gateway

A payment gateway that wraps real-world APIs behind the [x402 protocol](https://www.x402.org/), so AI agents can pay-per-request with crypto instead of managing API keys.

Built on the `@x402/express` SDK (v2.3.0) with direct on-chain verification for MegaETH.

## Supported Networks

| Network | Chain ID | Stablecoin | Decimals | Confirmation | Verification |
|---------|----------|------------|----------|--------------|--------------|
| **Base** | 8453 | USDC | 6 | ~2s | Via facilitator |
| **MegaETH** | 4326 | USDm | 18 | ~10ms | Direct on-chain |
| **Solana** | mainnet | USDC | 6 | ~400ms | Via facilitator |

MegaETH offers the fastest payment verification at <10ms using `eth_sendRawTransactionSync` ([EIP-7966](https://github.com/ethereum/EIPs/pull/7966)). Payments are verified directly on-chain without a facilitator — no settlement step, no response buffering.

## Services

### Compute

| Endpoint | Method | Price | Upstream | Description |
|----------|--------|-------|----------|-------------|
| `/api/image/fast` | POST | $0.015 | fal.ai | FLUX Schnell (~2s, drafts) |
| `/api/image/quality` | POST | $0.05 | fal.ai | FLUX.2 Pro (~5s, production) |
| `/api/image/text` | POST | $0.12 | fal.ai | Ideogram v3 (text/logos) |
| `/api/code/run` | POST | $0.005 | E2B | Sandbox (Python, JS, Bash, R) |
| `/api/transcribe` | POST | $0.10 | Deepgram | Audio to text (up to 10 min) |

### Crypto & Blockchain

| Endpoint | Method | Price | Upstream | Description |
|----------|--------|-------|----------|-------------|
| `/api/crypto/price` | GET | $0.001 | CoinGecko | Real-time prices |
| `/api/crypto/markets` | GET | $0.002 | CoinGecko | Market rankings |
| `/api/crypto/history` | GET | $0.003 | CoinGecko | Historical data |
| `/api/crypto/trending` | GET | $0.001 | CoinGecko | Trending coins |
| `/api/crypto/search` | GET | $0.001 | CoinGecko | Search by name/symbol |
| `/api/wallet/balances` | POST | $0.005 | Allium | Multichain wallet balances |
| `/api/wallet/transactions` | POST | $0.005 | Allium | Transaction history |
| `/api/wallet/pnl` | POST | $0.01 | Allium | Portfolio P&L |
| `/api/token/prices` | POST | $0.005 | Allium | DEX-derived token prices |
| `/api/token/metadata` | GET | $0.002 | Allium | Token metadata |

### Storage

| Endpoint | Method | Price | Upstream | Description |
|----------|--------|-------|----------|-------------|
| `/api/ipfs/pin` | POST | $0.01 | Pinata | Pin JSON, files, or URLs |
| `/api/ipfs/get` | GET | $0.001 | Pinata | Retrieve by CID |

## Quick Start

```bash
cp .env.example .env
# Fill in your wallet addresses, DATABASE_URL, and API keys

npm install
npm run dev
```

The server starts on `http://localhost:3402`.

### Example Requests

```bash
# Image generation (returns 402 without payment)
curl -X POST http://localhost:3402/api/image/fast \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a cat astronaut on the moon"}'

# Code execution (returns 402 without payment)
curl -X POST http://localhost:3402/api/code/run \
  -H "Content-Type: application/json" \
  -d '{"code": "print(sum(range(100)))", "language": "python"}'

# Crypto price (returns 402 without payment)
curl "http://localhost:3402/api/crypto/price?ids=bitcoin,ethereum&currencies=usd"

# IPFS pin JSON (returns 402 without payment)
curl -X POST http://localhost:3402/api/ipfs/pin \
  -H "Content-Type: application/json" \
  -d '{"json": {"name": "test"}, "name": "test.json"}'

# With dev bypass:
curl -H "X-DEV-BYPASS: dev-secret-change-me" \
  "http://localhost:3402/api/crypto/price?ids=bitcoin&currencies=usd"
```

### Free Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /health/deep` | Deep health check (DB, RPC, key pools, memory) |
| `GET /.well-known/x402.json` | x402 service discovery (networks, services, pricing) |
| `GET /api/services` | List all services |
| `GET /api/services/:id` | Single service details with payment options |
| `GET /facilitator/megaeth/status` | MegaETH RPC connectivity stats |

### Payment Flow

Without payment, API endpoints return `402 Payment Required` with a `PAYMENT-REQUIRED` header containing accepted payment options (base64 JSON).

**MegaETH flow** (fastest):
1. Agent sends USDm transfer via `eth_sendRawTransactionSync` (instant receipt)
2. Agent includes `txHash` in the `payment-signature` header (base64 JSON)
3. Gateway verifies the Transfer event on-chain (~10ms)
4. Request proceeds to the API handler

**Base / Solana flow:**
1. Agent constructs a payment via the x402 SDK client
2. Payment is verified and settled through the [official facilitator](https://x402.org/facilitator)

### Dev Bypass

In development mode (`NODE_ENV=development`), add the `X-DEV-BYPASS` header with your secret to skip payment:

```bash
curl -H "X-DEV-BYPASS: dev-secret-change-me" \
  "http://localhost:3402/api/crypto/price?ids=bitcoin&currencies=usd"
```

## Configuration

See [`.env.example`](.env.example) for all environment variables.

Required:
- `DATABASE_URL` — PostgreSQL connection string
- `PAY_TO_EVM` — EVM wallet address to receive Base and MegaETH payments
- `PAY_TO_SOLANA` — Solana wallet address to receive Solana payments

Provider keys (add as needed per category, supports comma-separated key pools):
- **Compute:** `FAL_API_KEYS`, `E2B_API_KEYS`, `DEEPGRAM_API_KEYS`
- **Crypto:** `COINGECKO_API_KEYS` (optional), `ALLIUM_API_KEYS`
- **Storage:** `PINATA_JWTS`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled server |
| `npm test` | Run unit tests (vitest) |
| `npm run test:unit` | Run MegaETH verification unit tests |
| `npm run test:rpc` | Run MegaETH RPC connectivity tests (hits mainnet) |
| `npm run test:integration` | Run full integration tests (requires running server) |

## Architecture

```
src/
  index.ts                  # Express app, middleware ordering, free endpoints
  config.ts                 # Typed env validation, CSV key pool support
  config/chains.ts          # Chain definitions (MegaETH, Base, Base Sepolia)
  middleware/
    x402.ts                 # SDK payment middleware (Base, Solana)
    payment.ts              # MegaETH direct payment middleware
    rate-limit.ts           # Rate limiting (free, paid, expensive tiers)
  verification/
    megaeth.ts              # On-chain receipt verification, replay protection
  facilitator/
    index.ts                # Custom MegaETH FacilitatorClient + HTTP endpoints
  services/
    registry.ts             # Service definitions, route config builder
  lib/
    key-pool.ts             # Round-robin API key rotation
    cache.ts                # In-memory TTL cache
    validation.ts           # Input validation, SSRF protection, safe logging
  providers/
    fal.ts                  # fal.ai (image generation)
    e2b.ts                  # E2B (code execution)
    deepgram.ts             # Deepgram (transcription)
    coingecko.ts            # CoinGecko (crypto prices)
    allium.ts               # Allium (wallet data, token prices)
    ipfs.ts                 # Pinata (IPFS storage)
  apis/
    image.ts                # Image generation (3 tiers)
    code.ts                 # Code execution sandbox
    transcribe.ts           # Audio transcription
    crypto.ts               # Crypto prices, markets, history (cached)
    blockchain.ts           # Wallet balances, transactions, P&L, tokens
    ipfs.ts                 # IPFS pin and retrieve
  db/
    ledger.ts               # PostgreSQL ledger (batched writes, replay protection)
```

Middleware ordering: JSON parsing > CORS > request ID > free routes > static files > rate limit > dev bypass > MegaETH direct verification > SDK payment middleware (Base/Solana) > API handlers.

## MegaETH Quirks

A few things to know when working with MegaETH:

- **Gas model differs from standard EVM.** ETH transfers cost ~63,349 gas (not 21,000). Base fee is stable at 0.001 gwei with no EIP-1559 adjustment. Always use `eth_estimateGas` for non-trivial operations.
- **USDm uses 18 decimals** (not 6 like USDC). `$0.001` = `1000000000000000` (10^15) in USDm vs `1000` (10^3) in USDC.
- **`eth_sendRawTransactionSync` and `realtime_sendRawTransaction`** both return receipts in <10ms. They are interchangeable.
- **Receipt latency from public RPC** averages ~70-100ms due to network round-trip. On-chain finality is still ~10ms.
- **Official x402 facilitator does not support MegaETH** (eip155:4326). This gateway uses a custom `FacilitatorClient` for the SDK integration and direct on-chain verification for the fast path.
