/**
 * MegaETH payment verification tests
 * Run: npx tsx test/verify-megaeth.ts
 *
 * Tests the direct on-chain verification flow:
 * 1. Facilitator /supported reports eip155:4326
 * 2. Facilitator /verify rejects missing txHash
 * 3. Facilitator /verify rejects invalid txHash
 * 4. Facilitator /status shows RPC connectivity
 * 5. 402 response includes MegaETH with correct USDm amounts
 *
 * Expects the server to be running on localhost:3402
 */

const BASE = process.env.GATEWAY_URL || "http://localhost:3402";

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
  console.log(`\nMegaETH Verification Tests at ${BASE}\n`);

  // --- Facilitator endpoint tests ---

  await test("GET /facilitator/megaeth/supported reports eip155:4326", async () => {
    const res = await fetch(`${BASE}/facilitator/megaeth/supported`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.kinds.length === 1, "Expected 1 supported kind");
    assert(body.kinds[0].network === "eip155:4326", "Wrong network");
    assert(body.kinds[0].scheme === "exact", "Wrong scheme");
    assert(body.kinds[0].extra?.name === "USDm", "Wrong asset name");
  });

  await test("POST /facilitator/megaeth/verify rejects missing txHash", async () => {
    const res = await fetch(`${BASE}/facilitator/megaeth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload: { x402Version: 2, payload: {} },
        paymentRequirements: { amount: "1000000000000000", payTo: "0x0001" },
      }),
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    const body = await res.json();
    assert(!body.isValid, "Should be invalid");
    assert(body.invalidReason === "missing_tx_hash", `Wrong reason: ${body.invalidReason}`);
  });

  await test("POST /facilitator/megaeth/verify rejects bogus txHash", async () => {
    const fakeTxHash = "0x" + "ab".repeat(32);
    const res = await fetch(`${BASE}/facilitator/megaeth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentPayload: {
          x402Version: 2,
          payload: { txHash: fakeTxHash },
        },
        paymentRequirements: {
          amount: "1000000000000000",
          payTo: "0x0000000000000000000000000000000000000001",
        },
      }),
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    const body = await res.json();
    assert(!body.isValid, "Should be invalid");
    assert(body.invalidReason === "verification_failed", `Wrong reason: ${body.invalidReason}`);
    console.log(`    (error: ${body.invalidMessage})`);
  });

  await test("GET /facilitator/megaeth/status shows RPC connectivity", async () => {
    const res = await fetch(`${BASE}/facilitator/megaeth/status`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.network === "eip155:4326", "Wrong network");
    assert(body.connected === true, "RPC should be connected");
    assert(body.stablecoin.symbol === "USDm", "Wrong stablecoin");
    assert(body.stablecoin.decimals === 18, "Wrong decimals");
    assert(typeof body.replayProtection.usedTxCount === "number", "Missing replay stats");
    console.log(`    (connected: ${body.connected}, usedTx: ${body.replayProtection.usedTxCount})`);
  });

  // --- 402 response format tests ---

  await test("402 response includes MegaETH with correct USDm math", async () => {
    const res = await fetch(`${BASE}/api/weather/current?q=London`);
    assert(res.status === 402, `Expected 402, got ${res.status}`);

    const header = res.headers.get("payment-required");
    assert(!!header, "Missing PAYMENT-REQUIRED header");
    const decoded = JSON.parse(atob(header!));

    const megaeth = decoded.accepts.find((a: any) => a.network === "eip155:4326");
    assert(!!megaeth, "MegaETH missing from accepts");

    // $0.001 at 18 decimals = 10^15
    assert(megaeth.amount === "1000000000000000", `Wrong amount: ${megaeth.amount}`);
    assert(
      megaeth.asset === "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
      `Wrong asset: ${megaeth.asset}`,
    );
    assert(megaeth.extra?.name === "USDm", `Wrong asset name: ${megaeth.extra?.name}`);
  });

  await test("402 for search ($0.002) has correct MegaETH USDm amount", async () => {
    const res = await fetch(`${BASE}/api/search/web?q=test`);
    const header = res.headers.get("payment-required");
    assert(!!header, "Missing PAYMENT-REQUIRED header");
    const decoded = JSON.parse(atob(header!));

    const megaeth = decoded.accepts.find((a: any) => a.network === "eip155:4326");
    assert(!!megaeth, "MegaETH missing from accepts");

    // $0.002 at 18 decimals = 2 * 10^15
    assert(megaeth.amount === "2000000000000000", `Wrong amount: ${megaeth.amount}`);
  });

  await test("402 for places ($0.005) has correct MegaETH USDm amount", async () => {
    const res = await fetch(`${BASE}/api/places/search?q=pizza`);
    const header = res.headers.get("payment-required");
    assert(!!header, "Missing PAYMENT-REQUIRED header");
    const decoded = JSON.parse(atob(header!));

    const megaeth = decoded.accepts.find((a: any) => a.network === "eip155:4326");
    assert(!!megaeth, "MegaETH missing from accepts");

    // $0.005 at 18 decimals = 5 * 10^15
    assert(megaeth.amount === "5000000000000000", `Wrong amount: ${megaeth.amount}`);
  });

  // --- Direct middleware tests (payment-signature header) ---

  await test("MegaETH payment header without txHash returns 402 from middleware", async () => {
    const paymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:4326",
        amount: "1000000000000000",
        asset: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
        payTo: "0x0000000000000000000000000000000000000001",
      },
      payload: {},
    };
    const encoded = btoa(JSON.stringify(paymentPayload));

    const res = await fetch(`${BASE}/api/weather/current?q=London`, {
      headers: { "payment-signature": encoded },
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    const body = await res.json();
    assert(body.error?.includes("txHash"), `Expected txHash error, got: ${body.error}`);
    assert(body.hint !== undefined, "Expected hint in response");
  });

  await test("MegaETH payment header with bogus txHash returns 402 from middleware", async () => {
    const paymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:4326",
        amount: "1000000000000000",
        asset: "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
        payTo: "0x0000000000000000000000000000000000000001",
      },
      payload: { txHash: "0x" + "ff".repeat(32) },
    };
    const encoded = btoa(JSON.stringify(paymentPayload));

    const res = await fetch(`${BASE}/api/weather/current?q=London`, {
      headers: { "payment-signature": encoded },
    });
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    const body = await res.json();
    assert(body.reason !== undefined, `Expected reason field, got: ${JSON.stringify(body)}`);
    assert(body.network === "eip155:4326", `Expected network in error response`);
    console.log(`    (reason: ${body.reason})`);
  });

  await test("Base payment header passes through to SDK middleware (not intercepted)", async () => {
    const paymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:84532",
        amount: "1000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0x0000000000000000000000000000000000000001",
      },
      payload: { someField: "test" },
    };
    const encoded = btoa(JSON.stringify(paymentPayload));

    const res = await fetch(`${BASE}/api/weather/current?q=London`, {
      headers: { "payment-signature": encoded },
    });
    // SDK middleware should handle this and return 402 (invalid payment)
    // NOT our middleware's custom error format
    assert(res.status === 402, `Expected 402, got ${res.status}`);
    const body = await res.json();
    // SDK returns {} as body (requirements in header), not our { error, reason } format
    assert(body.error === undefined || body.network !== "eip155:4326",
      "Base payment should not be handled by MegaETH middleware");
  });

  // --- Summary ---
  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
