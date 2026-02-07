# x402 Gateway

A payment gateway that wraps real-world APIs behind the [x402 protocol](https://www.x402.org/), so AI agents can pay-per-request with crypto instead of managing API keys.

Built on the `@x402/express` SDK (v2.3.0) with direct on-chain verification for MegaETH.

## Supported Networks

| Network | Chain ID | Stablecoin | Decimals | Confirmation | Verification |
|---------|----------|------------|----------|--------------|--------------|
| **MegaETH** | 4326 | USDm | 18 | ~10ms | Direct on-chain |
| **Base** | 8453 | USDC | 6 | ~2s | Via facilitator |
| **Solana** | mainnet | USDC | 6 | ~400ms | Via facilitator |

MegaETH offers the fastest payment verification at <10ms using `eth_sendRawTransactionSync` ([EIP-7966](https://github.com/ethereum/EIPs/pull/7966)). Payments are verified directly on-chain without a facilitator — no settlement step, no response buffering.

### MegaETH Details

- **RPC:** `https://mainnet.megaeth.com/rpc`
- **WebSocket:** `wss://mainnet.megaeth.com/ws`
- **Explorer:** [megaeth.blockscout.com](https://megaeth.blockscout.com)
- **USDm contract:** [`0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7`](https://megaeth.blockscout.com/address/0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7)

## Services

### Basic

| Endpoint | Price | Upstream |
|----------|-------|----------|
| `GET /api/weather/current` | $0.001 | OpenWeatherMap |
| `GET /api/search/web` | $0.002 | Brave Search |
| `GET /api/places/search` | $0.005 | Google Places |

### Enrichment

| Endpoint | Price | Upstream |
|----------|-------|----------|
| `GET /api/enrich/company` | $0.05 | Proxycurl |
| `GET /api/enrich/person` | $0.03 | Proxycurl |
| `GET /api/enrich/email/verify` | $0.01 | Hunter.io |
| `GET /api/enrich/email/find` | $0.02 | Hunter.io |
| `GET /api/search/people` | $0.10 | Proxycurl |

### Travel

| Endpoint | Price | Upstream |
|----------|-------|----------|
| `GET /api/travel/flights` | $0.10 | Amadeus |
| `GET /api/travel/hotels` | $0.05 | Amadeus |
| `GET /api/travel/airports` | $0.005 | Amadeus |

### Compute

| Endpoint | Method | Price | Upstream | Description |
|----------|--------|-------|----------|-------------|
| `/api/image/fast` | POST | $0.015 | fal.ai | FLUX Schnell (~2s, drafts) |
| `/api/image/quality` | POST | $0.05 | fal.ai | FLUX.2 Pro (~5s, production) |
| `/api/image/text` | POST | $0.12 | fal.ai | Ideogram v3 (text/logos) |
| `/api/code/run` | POST | $0.005 | E2B | Sandbox (Python, JS, Bash, R) |
| `/api/transcribe` | POST | $0.10 | Deepgram | Audio to text (up to 10 min) |

### Crypto

| Endpoint | Price | Upstream | Description |
|----------|-------|----------|-------------|
| `GET /api/crypto/price` | $0.001 | CoinGecko | Real-time prices |
| `GET /api/crypto/markets` | $0.002 | CoinGecko | Market rankings |
| `GET /api/crypto/history` | $0.003 | CoinGecko | Historical data |
| `GET /api/crypto/trending` | $0.001 | CoinGecko | Trending coins |
| `GET /api/crypto/search` | $0.001 | CoinGecko | Search by name/symbol |
| `POST /api/rpc/call` | $0.001 | Alchemy | Multi-chain JSON-RPC |
| `POST /api/rpc/batch` | $0.01 | Alchemy | Batch RPC (up to 100) |

### Storage

| Endpoint | Method | Price | Upstream | Description |
|----------|--------|-------|----------|-------------|
| `/api/ipfs/pin` | POST | $0.01 | Pinata | Pin JSON, files, or URLs |
| `/api/ipfs/get` | GET | $0.001 | Pinata | Retrieve by CID |

## Why Cheaper Than Frontier LLMs?

| Task | Claude/GPT Cost | Gateway Cost | Savings |
|------|-----------------|--------------|---------|
| Image Generation | ~$0.08-0.15 | $0.015-0.12 | 5-10x |
| Code Execution | ~$0.10-0.50 | $0.005 | 20-100x |
| Transcription | ~$0.05-0.10/min | $0.10 flat | 5-10x |

Frontier LLMs are expensive for "dumb" compute tasks. Delegate to specialized providers, use the LLM for thinking.

## Quick Start

```bash
cp .env.example .env
# Fill in your wallet addresses and API keys

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

# Blockchain RPC (returns 402 without payment)
curl -X POST http://localhost:3402/api/rpc/call \
  -H "Content-Type: application/json" \
  -d '{"chain": "ethereum", "method": "eth_blockNumber", "params": []}'

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
| `GET /.well-known/x402.json` | x402 service discovery (networks, services, pricing) |
| `GET /api/services` | List all services |
| `GET /api/services/:id` | Single service details with payment options |
| `GET /api/rpc/chains` | List supported blockchain chains |
| `GET /facilitator/megaeth/status` | MegaETH RPC connectivity and replay protection stats |

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
  "http://localhost:3402/api/weather/current?q=London"
```

## Configuration

See [`.env.example`](.env.example) for all environment variables.

Required:
- `PAY_TO_EVM` — EVM wallet address to receive Base and MegaETH payments
- `PAY_TO_SOLANA` — Solana wallet address to receive Solana payments

Provider keys (add as needed per category):
- **Basic:** `OPENWEATHER_API_KEYS`, `BRAVE_SEARCH_API_KEYS`, `GOOGLE_PLACES_API_KEYS`
- **Enrichment:** `PROXYCURL_API_KEYS`, `HUNTER_API_KEYS`
- **Travel:** `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET`
- **Compute:** `FAL_API_KEY`, `E2B_API_KEY`, `DEEPGRAM_API_KEY`
- **Crypto:** `COINGECKO_API_KEY` (optional), `ALCHEMY_API_KEY`
- **Storage:** `PINATA_JWT`

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
  config.ts                 # Typed env validation
  config/chains.ts          # Chain definitions (MegaETH, Base)
  middleware/
    x402.ts                 # SDK payment middleware (Base, Solana)
    payment.ts              # MegaETH direct payment middleware
  verification/
    megaeth.ts              # On-chain receipt verification, replay protection
  facilitator/
    index.ts                # Custom MegaETH FacilitatorClient + HTTP endpoints
  services/
    registry.ts             # Service definitions, route config builder
    key-pool.ts             # Round-robin API key selection
  providers/
    proxycurl.ts            # Proxycurl (LinkedIn enrichment)
    hunter.ts               # Hunter.io (email)
    amadeus.ts              # Amadeus (travel)
    fal.ts                  # fal.ai (image generation)
    e2b.ts                  # E2B (code execution)
    deepgram.ts             # Deepgram (transcription)
    coingecko.ts            # CoinGecko (crypto prices)
    rpc.ts                  # Multi-chain blockchain RPC
    ipfs.ts                 # Pinata (IPFS storage)
  apis/
    weather.ts              # OpenWeatherMap handler
    web-search.ts           # Brave Search handler
    maps.ts                 # Google Places handler
    enrich.ts               # Company/person enrichment, email verify/find
    people-search.ts        # People search by company/role
    travel.ts               # Flights, hotels, airport lookup
    image.ts                # Image generation (3 tiers)
    code.ts                 # Code execution sandbox
    transcribe.ts           # Audio transcription
    crypto.ts               # Crypto prices, markets, history
    rpc.ts                  # Blockchain RPC calls
    ipfs.ts                 # IPFS pin and retrieve
  db/
    ledger.ts               # SQLite ledger (requests, API key usage)
```

Middleware ordering: JSON parsing > free routes > dev bypass > MegaETH direct verification > SDK payment middleware (Base/Solana) > API handlers.

## MegaETH Quirks

A few things to know when working with MegaETH:

- **Gas model differs from standard EVM.** ETH transfers cost ~63,349 gas (not 21,000). Base fee is stable at 0.001 gwei with no EIP-1559 adjustment. Always use `eth_estimateGas` for non-trivial operations.
- **USDm uses 18 decimals** (not 6 like USDC). `$0.001` = `1000000000000000` (10^15) in USDm vs `1000` (10^3) in USDC.
- **`eth_sendRawTransactionSync` and `realtime_sendRawTransaction`** both return receipts in <10ms. They are interchangeable.
- **Receipt latency from public RPC** averages ~70-100ms due to network round-trip. On-chain finality is still ~10ms.
- **Official x402 facilitator does not support MegaETH** (eip155:4326). This gateway uses a custom `FacilitatorClient` for the SDK integration and direct on-chain verification for the fast path.
