/**
 * Mock payment flow test (placeholder)
 *
 * In a real testnet setup, this would:
 * 1. Create a payment payload using @x402/evm or @x402/svm client
 * 2. Sign it with a testnet wallet
 * 3. Send the request with PAYMENT-SIGNATURE header
 * 4. Verify the response contains settlement info
 *
 * For now this documents the expected flow.
 */

const BASE = process.env.GATEWAY_URL || "http://localhost:3402";

async function run() {
  console.log("Mock Payment Flow Test");
  console.log("======================\n");

  // Step 1: Get payment requirements
  console.log("Step 1: Request resource without payment...");
  const res = await fetch(`${BASE}/api/weather/current?q=London`);
  console.log(`  Status: ${res.status}`);

  if (res.status === 402) {
    const body = await res.json();
    console.log(`  x402 Version: ${body.x402Version}`);
    console.log(`  Accepted payment methods: ${body.accepts?.length ?? 0}`);

    for (const accept of body.accepts ?? []) {
      console.log(`    - ${accept.scheme} on ${accept.network}: ${accept.amount} to ${accept.payTo}`);
    }

    console.log("\nStep 2: (Would create payment payload with testnet wallet)");
    console.log("Step 3: (Would send request with PAYMENT-SIGNATURE header)");
    console.log("Step 4: (Would verify 200 response with settlement headers)");
    console.log("\n  To complete this flow, configure a testnet wallet and use:");
    console.log("    import { ExactEvmScheme } from '@x402/evm'");
    console.log("    import { toClientEvmSigner } from '@x402/evm'");
    console.log("    const signer = toClientEvmSigner(walletClient)");
    console.log("    const scheme = new ExactEvmScheme(signer)");
    console.log("    const payload = await scheme.createPaymentPayload(2, requirements)");
  } else {
    console.log("  Unexpected status (is server running with payment middleware?)");
  }
}

run().catch(console.error);
