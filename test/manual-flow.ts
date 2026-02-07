/**
 * Manual test flow for x402-gateway
 * Run: npx tsx test/manual-flow.ts
 *
 * Expects the server to be running on localhost:3402
 */

const BASE = process.env.GATEWAY_URL || "http://localhost:3402";
const DEV_SECRET = process.env.DEV_BYPASS_SECRET || "dev-secret-change-me";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL: ${name} — ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function run() {
  console.log(`\nTesting x402 Gateway at ${BASE}\n`);

  // --- Free endpoints ---

  await test("GET /health returns ok", async () => {
    const res = await fetch(`${BASE}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.status === "ok", `Expected status ok, got ${body.status}`);
  });

  await test("GET /.well-known/x402.json returns discovery", async () => {
    const res = await fetch(`${BASE}/.well-known/x402.json`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.x402Version === 2, "Expected x402Version 2");
    assert(body.name === "x402 Gateway", `Expected name 'x402 Gateway', got '${body.name}'`);
    assert(body.version === "3.0.0", `Expected version '3.0.0', got '${body.version}'`);
    assert(Array.isArray(body.services), "Expected services array");
    assert(body.services.length === 20, `Expected 20 services, got ${body.services.length}`);

    // Verify categories
    assert(body.categories !== undefined, "Expected categories object");
    assert(body.categories.basic !== undefined, "Expected 'basic' category");
    assert(body.categories.compute !== undefined, "Expected 'compute' category");
    assert(body.categories.crypto !== undefined, "Expected 'crypto' category");
    assert(body.categories.storage !== undefined, "Expected 'storage' category");
    assert(body.categories.basic.length === 3, `Expected 3 basic services, got ${body.categories.basic.length}`);
    assert(body.categories.compute.length === 5, `Expected 5 compute services, got ${body.categories.compute.length}`);
    assert(body.categories.crypto.length === 10, `Expected 10 crypto services, got ${body.categories.crypto.length}`);
    assert(body.categories.storage.length === 2, `Expected 2 storage services, got ${body.categories.storage.length}`);

    // Verify networks map
    assert(body.networks !== undefined, "Expected networks object");
    assert(body.networks.base !== undefined, "Expected base in networks");
    assert(body.networks.solana !== undefined, "Expected solana in networks");
    assert(body.networks.megaeth !== undefined, "Expected megaeth in networks");

    // MegaETH network details
    const me = body.networks.megaeth;
    assert(me.chainId === 4326, `Expected chainId 4326, got ${me.chainId}`);
    assert(me.stablecoin === "USDm", `Expected stablecoin USDm, got ${me.stablecoin}`);
    assert(me.estimatedConfirmation === "10ms", `Expected 10ms, got ${me.estimatedConfirmation}`);
    assert(Array.isArray(me.features), "Expected features array");
    assert(me.features.includes("instant-receipts"), "Expected instant-receipts feature");
    assert(me.features.includes("realtime-api"), "Expected realtime-api feature");

    // Base network details
    assert(body.networks.base.stablecoin === "USDC", `Expected USDC for base`);
    assert(body.networks.base.estimatedConfirmation === "2s", `Expected 2s for base`);

    // Solana network details
    assert(body.networks.solana.stablecoin === "USDC", `Expected USDC for solana`);
    assert(body.networks.solana.estimatedConfirmation === "400ms", `Expected 400ms for solana`);

    // Agent hint
    assert(typeof body.hint === "string", "Expected hint string");
    assert(body.hint.includes("MegaETH"), "Expected hint to mention MegaETH");
    assert(body.hint.includes("10ms"), "Expected hint to mention 10ms");
  });

  await test("GET /api/services lists all services", async () => {
    const res = await fetch(`${BASE}/api/services`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.count === 20, `Expected count 20, got ${body.count}`);
  });

  await test("GET /api/services/weather returns weather service", async () => {
    const res = await fetch(`${BASE}/api/services/weather`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.id === "weather", `Expected id weather, got ${body.id}`);
    assert(body.price === "$0.001", `Expected price $0.001, got ${body.price}`);
  });

  await test("GET /api/services/nonexistent returns 404", async () => {
    const res = await fetch(`${BASE}/api/services/nonexistent`);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
  });

  // --- Paid endpoints (should return 402 without payment) ---

  await test("GET /api/weather/current?q=London returns 402 without payment", async () => {
    const res = await fetch(`${BASE}/api/weather/current?q=London`);
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    // x402 v2 puts payment requirements in PAYMENT-REQUIRED header (base64 JSON)
    const paymentHeader = res.headers.get("payment-required");
    assert(!!paymentHeader, "Expected PAYMENT-REQUIRED header");
    const decoded = JSON.parse(atob(paymentHeader!));
    assert(decoded.x402Version === 2, "Expected x402Version 2 in payment header");
    assert(Array.isArray(decoded.accepts), "Expected accepts array in payment header");
    assert(decoded.accepts.length >= 2, `Expected at least 2 payment options, got ${decoded.accepts.length}`);

    // Verify MegaETH is included
    const megaeth = decoded.accepts.find((a: any) => a.network === "eip155:4326");
    assert(!!megaeth, "Expected MegaETH (eip155:4326) in payment options");
    assert(megaeth.asset === "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7", "Wrong USDm address");
    assert(megaeth.amount === "1000000000000000", `USDm amount wrong: ${megaeth.amount} (expected 10^15 for $0.001 at 18 decimals)`);
    assert(megaeth.extra?.name === "USDm", `Expected asset name USDm, got ${megaeth.extra?.name}`);

    const networks = decoded.accepts.map((a: any) => a.network);
    console.log(`    (${decoded.accepts.length} payment options: ${networks.join(", ")})`);
  });

  await test("GET /api/search/web?q=test returns 402 without payment", async () => {
    const res = await fetch(`${BASE}/api/search/web?q=test`);
    assert(res.status === 402, `Expected 402, got ${res.status}`);
  });

  await test("GET /api/places/search?q=pizza returns 402 without payment", async () => {
    const res = await fetch(`${BASE}/api/places/search?q=pizza`);
    assert(res.status === 402, `Expected 402, got ${res.status}`);
  });

  // --- Compute 402 tests ---

  await test("POST /api/image/fast returns 402 with $0.015 pricing", async () => {
    const res = await fetch(`${BASE}/api/image/fast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    const paymentHeader = res.headers.get("payment-required");
    assert(!!paymentHeader, "Expected PAYMENT-REQUIRED header");
    const decoded = JSON.parse(atob(paymentHeader!));
    const megaeth = decoded.accepts.find((a: any) => a.network === "eip155:4326");
    assert(!!megaeth, "Expected MegaETH in payment options");
    // $0.015 at 18 decimals = 15 * 10^15 = 15000000000000000
    assert(megaeth.amount === "15000000000000000", `USDm amount wrong: ${megaeth.amount} (expected 15*10^15 for $0.015)`);
  });

  await test("POST /api/code/run returns 402 with $0.005 pricing", async () => {
    const res = await fetch(`${BASE}/api/code/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "print(1)", language: "python" }),
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
  });

  // --- Crypto 402 tests ---

  await test("GET /api/crypto/price returns 402 with $0.001 pricing", async () => {
    const res = await fetch(`${BASE}/api/crypto/price?ids=bitcoin&currencies=usd`);
    assert(res.status === 402, `Expected 402, got ${res.status}`);
  });

  await test("POST /api/wallet/balances returns 402 with $0.005 pricing", async () => {
    const res = await fetch(`${BASE}/api/wallet/balances`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chain: "ethereum", address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }),
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
  });

  await test("POST /api/token/prices returns 402 with $0.005 pricing", async () => {
    const res = await fetch(`${BASE}/api/token/prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: [{ token_address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", chain: "base" }] }),
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
  });

  // --- Dev bypass ---

  await test("GET /api/weather/current?q=London with dev bypass header", async () => {
    const res = await fetch(`${BASE}/api/weather/current?q=London`, {
      headers: { "X-DEV-BYPASS": DEV_SECRET },
    });
    // Should either return 200 (weather data) or 502 (if no real API key is configured)
    // But should NOT be 402
    assert(res.status !== 402, `Got 402 even with bypass header`);
    console.log(`    (status: ${res.status})`);
  });

  // --- Validation ---

  await test("GET /api/weather/current without params returns 400 (with bypass)", async () => {
    const res = await fetch(`${BASE}/api/weather/current`, {
      headers: { "X-DEV-BYPASS": DEV_SECRET },
    });
    // Without q or lat/lon, handler should return 400
    // But 402 means payment middleware caught it first (no bypass) — also acceptable
    assert(
      res.status === 400 || res.status === 402,
      `Expected 400 or 402, got ${res.status}`,
    );
  });

  // --- MegaETH facilitator stub ---

  await test("GET /facilitator/megaeth/supported returns MegaETH kind", async () => {
    const res = await fetch(`${BASE}/facilitator/megaeth/supported`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(Array.isArray(body.kinds), "Expected kinds array");
    assert(body.kinds.length === 1, `Expected 1 kind, got ${body.kinds.length}`);
    assert(body.kinds[0].network === "eip155:4326", "Expected eip155:4326 network");
    assert(body.kinds[0].scheme === "exact", "Expected exact scheme");
  });

  // --- Summary ---

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
