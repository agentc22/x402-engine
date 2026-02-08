import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { getBase58Codec } from "@solana/codecs";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactSvmScheme } from "@x402/svm/exact/client";

const GATEWAY = process.env.GATEWAY_URL || "http://localhost:3402";
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY;
if (!SOLANA_PRIVATE_KEY) { console.error("Set SOLANA_PRIVATE_KEY"); process.exit(1); }

async function main() {
  const codec = getBase58Codec();
  const keyBytes = codec.encode(SOLANA_PRIVATE_KEY);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(keyBytes);
  console.log("Wallet:", signer.address);

  const client = new x402Client();
  registerExactSvmScheme(client, {
    signer,
    networks: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
  });

  const httpClient = new x402HTTPClient(client);

  // Get 402 and parse
  const res = await fetch(`${GATEWAY}/api/crypto/price?ids=bitcoin&currencies=usd`);
  const getHeader = (name: string) => res.headers.get(name);
  let body: any;
  try { body = await res.json(); } catch {}
  const paymentRequired = httpClient.getPaymentRequiredResponse(getHeader, body);
  console.log("Payment required parsed OK");

  // Create payment
  const payload = await client.createPaymentPayload(paymentRequired);
  console.log("Payload x402Version:", payload.x402Version);
  console.log("Payload keys:", Object.keys(payload));

  // Encode header
  const headers = httpClient.encodePaymentSignatureHeader(payload);
  console.log("Headers to send:", Object.keys(headers));

  for (const [headerName, headerValue] of Object.entries(headers)) {
    console.log(`\nSending with header: ${headerName} (${headerValue.length} chars)`);
    const retryRes = await fetch(`${GATEWAY}/api/crypto/price?ids=bitcoin&currencies=usd`, {
      headers: { [headerName]: headerValue },
    });
    console.log("Status:", retryRes.status);

    if (retryRes.status !== 200) {
      // Check all response headers
      for (const [k, v] of retryRes.headers.entries()) {
        if (k.toLowerCase().includes("payment") || k.toLowerCase().includes("x-")) {
          console.log(`  ${k}: ${v.slice(0, 100)}`);
        }
      }
    }

    const text = await retryRes.text();
    console.log("Body:", text.slice(0, 500));
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  console.error(e.stack?.split("\n").slice(0, 8).join("\n"));
});
