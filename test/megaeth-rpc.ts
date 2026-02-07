/**
 * MegaETH RPC Manual Test Script
 * Run: npx tsx test/megaeth-rpc.ts
 *
 * Connects to MegaETH mainnet and verifies:
 * 1. RPC connectivity and chain ID
 * 2. realtime_sendRawTransaction / eth_sendRawTransactionSync availability
 * 3. eth_getTransactionReceipt latency
 * 4. USDm contract accessibility
 * 5. Gas model quirks
 *
 * Does NOT require the gateway server to be running.
 */

const RPC = process.env.MEGAETH_RPC || "https://mainnet.megaeth.com/rpc";
const USDM_ADDRESS = "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7";

let passed = 0;
let failed = 0;
const quirks: string[] = [];

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

async function rpcCall(method: string, params: any[] = []): Promise<any> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

/** Measure latency of an RPC call in ms. */
async function measureLatency(method: string, params: any[] = []): Promise<{ result: any; ms: number }> {
  const start = performance.now();
  const result = await rpcCall(method, params);
  const ms = Math.round(performance.now() - start);
  return { result, ms };
}

async function run() {
  console.log(`\nMegaETH RPC Tests at ${RPC}\n`);

  // --- 1. Basic connectivity ---

  await test("eth_chainId returns 0x10e6 (4326)", async () => {
    const chainId = await rpcCall("eth_chainId");
    assert(chainId === "0x10e6", `Expected 0x10e6, got ${chainId}`);
    console.log(`    chain ID: ${parseInt(chainId, 16)} (${chainId})`);
  });

  await test("eth_blockNumber returns a recent block", async () => {
    const { result: blockNum, ms } = await measureLatency("eth_blockNumber");
    const height = parseInt(blockNum, 16);
    assert(height > 1_000_000, `Block height too low: ${height}`);
    console.log(`    block height: ${height.toLocaleString()} (${ms}ms)`);
  });

  await test("net_version returns 4326", async () => {
    const netVersion = await rpcCall("net_version");
    assert(netVersion === "4326", `Expected "4326", got ${netVersion}`);
  });

  // --- 2. realtime_sendRawTransaction availability ---

  await test("realtime_sendRawTransaction is recognized (not method-not-found)", async () => {
    // Send a deliberately invalid tx — we just want to confirm the method
    // exists (doesn't return "method not found"). It should return a
    // different error like "invalid transaction" or "rlp decode error".
    try {
      await rpcCall("realtime_sendRawTransaction", ["0x00"]);
      // If it somehow succeeds, that's fine too
    } catch (err: any) {
      const msg = err.message.toLowerCase();
      // "method not found" means the endpoint doesn't exist
      assert(
        !msg.includes("method not found") && !msg.includes("not supported"),
        `realtime_sendRawTransaction not available: ${err.message}`,
      );
      console.log(`    (correctly rejects invalid tx)`);
    }
  });

  await test("eth_sendRawTransactionSync (EIP-7966) is recognized", async () => {
    try {
      await rpcCall("eth_sendRawTransactionSync", ["0x00"]);
    } catch (err: any) {
      const msg = err.message.toLowerCase();
      assert(
        !msg.includes("method not found") && !msg.includes("not supported"),
        `eth_sendRawTransactionSync not available: ${err.message}`,
      );
      console.log(`    (correctly rejects invalid tx)`);
    }
  });

  // --- 3. Transaction receipt latency ---

  await test("eth_getTransactionReceipt latency for known recent block", async () => {
    // First get a recent block to find a real tx hash
    const blockNum = await rpcCall("eth_blockNumber");
    const block = await rpcCall("eth_getBlockByNumber", [blockNum, false]);

    if (!block || !block.transactions || block.transactions.length === 0) {
      // Try a few blocks back
      const prevBlock = "0x" + (parseInt(blockNum, 16) - 10).toString(16);
      const prev = await rpcCall("eth_getBlockByNumber", [prevBlock, false]);
      assert(prev?.transactions?.length > 0, "No transactions found in recent blocks");
      const txHash = prev.transactions[0];

      const { ms } = await measureLatency("eth_getTransactionReceipt", [txHash]);
      console.log(`    receipt latency: ${ms}ms (tx: ${txHash.slice(0, 18)}...)`);

      if (ms > 50) {
        quirks.push(`Receipt latency (${ms}ms) higher than expected for a 10ms chain`);
      }
    } else {
      const txHash = block.transactions[0];
      const { ms } = await measureLatency("eth_getTransactionReceipt", [txHash]);
      console.log(`    receipt latency: ${ms}ms (tx: ${txHash.slice(0, 18)}...)`);
    }
  });

  await test("Multiple receipt fetches to measure consistency", async () => {
    const blockNum = await rpcCall("eth_blockNumber");
    // Try a few blocks back to ensure they have txs
    const heights = [0, -5, -10, -20, -50].map(
      (offset) => "0x" + (parseInt(blockNum, 16) + offset).toString(16),
    );

    const latencies: number[] = [];
    for (const h of heights) {
      const block = await rpcCall("eth_getBlockByNumber", [h, false]);
      if (block?.transactions?.length > 0) {
        const { ms } = await measureLatency("eth_getTransactionReceipt", [
          block.transactions[0],
        ]);
        latencies.push(ms);
      }
    }

    assert(latencies.length >= 2, `Only got ${latencies.length} samples`);

    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    console.log(`    ${latencies.length} samples: avg=${avg}ms, min=${min}ms, max=${max}ms`);

    if (max > avg * 3 && max > 100) {
      quirks.push(`Receipt latency spikes: avg=${avg}ms but max=${max}ms — consider retry logic`);
    }
  });

  // --- 4. USDm contract accessibility ---

  await test("USDm contract responds to balanceOf", async () => {
    // balanceOf(address(0)) — just checking the contract is callable
    const zeroAddr = "00".repeat(32);
    const calldata = "0x70a08231" + zeroAddr; // balanceOf(address)
    const result = await rpcCall("eth_call", [
      { to: USDM_ADDRESS, data: calldata },
      "latest",
    ]);
    assert(result !== null && result !== undefined, "balanceOf returned null");
    assert(result.startsWith("0x"), `Unexpected result format: ${result}`);
    console.log(`    balanceOf(0x0) = ${BigInt(result).toLocaleString()} base units`);
  });

  await test("USDm decimals() returns 18", async () => {
    const calldata = "0x313ce567"; // decimals()
    const result = await rpcCall("eth_call", [
      { to: USDM_ADDRESS, data: calldata },
      "latest",
    ]);
    const decimals = parseInt(result, 16);
    assert(decimals === 18, `Expected 18 decimals, got ${decimals}`);
    console.log(`    decimals: ${decimals}`);
  });

  await test("USDm symbol() returns USDm", async () => {
    const calldata = "0x95d89b41"; // symbol()
    const result = await rpcCall("eth_call", [
      { to: USDM_ADDRESS, data: calldata },
      "latest",
    ]);
    // ABI-decode string: skip offset (32 bytes) + length (32 bytes), then read the string
    const hexStr = result.slice(2); // strip 0x
    const offset = parseInt(hexStr.slice(0, 64), 16) * 2; // byte offset → hex offset
    const length = parseInt(hexStr.slice(offset, offset + 64), 16);
    const bytes = hexStr.slice(offset + 64, offset + 64 + length * 2);
    const symbol = Buffer.from(bytes, "hex").toString("utf-8");
    assert(symbol === "USDm", `Expected "USDm", got "${symbol}"`);
    console.log(`    symbol: ${symbol}`);
  });

  // --- 5. Gas model quirks ---

  await test("eth_gasPrice reports stable low fee", async () => {
    const gasPrice = await rpcCall("eth_gasPrice");
    const gweiPrice = parseInt(gasPrice, 16) / 1e9;
    console.log(`    gas price: ${gweiPrice} gwei (${parseInt(gasPrice, 16)} wei)`);

    if (gweiPrice > 0.01) {
      quirks.push(`Gas price (${gweiPrice} gwei) higher than expected 0.001 gwei`);
    }
    if (Math.abs(gweiPrice - 0.001) < 0.0001) {
      console.log(`    (confirmed: stable 0.001 gwei base fee)`);
    }
  });

  await test("eth_estimateGas for ETH transfer", async () => {
    const estimate = await rpcCall("eth_estimateGas", [
      {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002",
        value: "0x1",
      },
    ]);
    const gas = parseInt(estimate, 16);
    console.log(`    ETH transfer estimate: ${gas.toLocaleString()} gas`);

    if (gas !== 21000) {
      quirks.push(
        `ETH transfer costs ${gas.toLocaleString()} gas (NOT standard 21,000) — MegaETH uses a different execution model`,
      );
    }
  });

  // --- Summary ---

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed}`);

  if (quirks.length > 0) {
    console.log(`\nMegaETH Quirks Discovered:`);
    quirks.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  } else {
    console.log(`\nNo unexpected quirks discovered.`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
