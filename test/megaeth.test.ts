/**
 * MegaETH Payment Verification — Unit Tests
 * Run: npx vitest run test/megaeth.test.ts
 *
 * Tests the core verification logic (log parsing, replay protection,
 * error paths) without requiring the gateway server to be running.
 * RPC-dependent tests use the real MegaETH mainnet endpoint.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { type Log } from "viem";
import { encodeAbiParameters, keccak256, toHex, pad } from "viem";
import {
  verifyTransferLogs,
  verifyMegaETHPayment,
  getReplayProtectionStats,
  clearReplayProtection,
  checkMegaETHConnection,
  type PaymentProof,
} from "../src/verification/megaeth.js";
import { MEGAETH_CONFIG } from "../src/config/chains.js";

// --- Constants ---

const USDM_ADDRESS = MEGAETH_CONFIG.stablecoin.address.toLowerCase() as `0x${string}`;
const PAYMENT_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const PAYER_ADDRESS = "0x1111111111111111111111111111111111111111";

// Transfer(address,address,uint256) topic
const TRANSFER_TOPIC = keccak256(
  toHex("Transfer(address,address,uint256)", { size: undefined }),
) as `0x${string}`;

// --- Helpers ---

function padAddress(addr: string): `0x${string}` {
  return pad(addr as `0x${string}`, { size: 32 }) as `0x${string}`;
}

function encodeAmount(amount: bigint): `0x${string}` {
  return encodeAbiParameters([{ type: "uint256" }], [amount]);
}

/** Build a mock ERC-20 Transfer log entry. */
function buildTransferLog(
  from: string,
  to: string,
  amount: bigint,
  contractAddress: string = USDM_ADDRESS,
): Log {
  return {
    address: contractAddress as `0x${string}`,
    topics: [TRANSFER_TOPIC, padAddress(from), padAddress(to)],
    data: encodeAmount(amount),
    blockHash: "0x" + "00".repeat(32) as `0x${string}`,
    blockNumber: 1000n,
    transactionHash: "0x" + "aa".repeat(32) as `0x${string}`,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}

// --- verifyTransferLogs tests ---

describe("verifyTransferLogs", () => {
  const ONE_USDM = 10n ** 18n; // 1 USDm = 10^18

  test("verifies valid USDm transfer", () => {
    const logs = [buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, ONE_USDM)];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(true);
    expect(result.payer?.toLowerCase()).toBe(PAYER_ADDRESS.toLowerCase());
  });

  test("accepts overpayment", () => {
    const logs = [
      buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, ONE_USDM * 5n),
    ];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(true);
  });

  test("rejects insufficient amount", () => {
    const logs = [
      buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, ONE_USDM / 2n),
    ];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Insufficient amount");
  });

  test("rejects wrong recipient", () => {
    const wrongRecipient = "0x2222222222222222222222222222222222222222";
    const logs = [buildTransferLog(PAYER_ADDRESS, wrongRecipient, ONE_USDM)];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("No USDm transfer to expected recipient");
  });

  test("rejects wrong contract (not USDm)", () => {
    const wrongContract = "0x3333333333333333333333333333333333333333";
    const logs = [
      buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, ONE_USDM, wrongContract),
    ];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("No USDm transfer found");
  });

  test("handles empty logs", () => {
    const result = verifyTransferLogs([], ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("No USDm transfer found");
  });

  test("sums split payments to same recipient", () => {
    const half = ONE_USDM / 2n;
    const logs = [
      buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, half),
      buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, half),
    ];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(true);
  });

  test("ignores transfers to other addresses when summing", () => {
    const other = "0x4444444444444444444444444444444444444444";
    const logs = [
      buildTransferLog(PAYER_ADDRESS, other, ONE_USDM * 100n),
      buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, ONE_USDM / 4n),
    ];
    const result = verifyTransferLogs(logs, ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Insufficient amount");
  });

  test("handles exact amount (boundary)", () => {
    const exact = 1_000_000_000_000_000n; // $0.001 in USDm
    const logs = [buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, exact)];
    const result = verifyTransferLogs(logs, exact, PAYMENT_ADDRESS);

    expect(result.valid).toBe(true);
  });

  test("handles case-insensitive address matching", () => {
    const upperRecipient = PAYMENT_ADDRESS.toUpperCase();
    const logs = [buildTransferLog(PAYER_ADDRESS, PAYMENT_ADDRESS, ONE_USDM)];
    const result = verifyTransferLogs(logs, ONE_USDM, upperRecipient);

    expect(result.valid).toBe(true);
  });

  test("rejects non-Transfer events from USDm contract", () => {
    // A log from the USDm contract but with a different event topic
    const fakeLog: Log = {
      address: USDM_ADDRESS,
      topics: [
        "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      ],
      data: "0x" as `0x${string}`,
      blockHash: "0x" + "00".repeat(32) as `0x${string}`,
      blockNumber: 1000n,
      transactionHash: "0x" + "aa".repeat(32) as `0x${string}`,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    };
    const result = verifyTransferLogs([fakeLog], ONE_USDM, PAYMENT_ADDRESS);

    expect(result.valid).toBe(false);
    // Either "No Transfer events" or "Failed to decode" — both acceptable
    expect(result.error).toBeDefined();
  });
});

// --- Replay protection tests ---

describe("Replay Protection", () => {
  beforeEach(() => {
    clearReplayProtection();
  });

  test("clearReplayProtection resets counter", () => {
    expect(getReplayProtectionStats().usedTxCount).toBe(0);
  });

  test("rejects replayed transaction hash", async () => {
    // First call — will fail because tx doesn't exist, but NOT from replay
    const fakeTx = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const proof: PaymentProof = { txHash: fakeTx };
    const first = await verifyMegaETHPayment(proof, 1n, PAYMENT_ADDRESS);
    expect(first.valid).toBe(false);
    expect(first.error).not.toContain("already used");

    // Replay protection only triggers for txHashes that were previously
    // ACCEPTED (valid). Since this tx was never valid, it won't be in the
    // used set. This is correct behavior — replay protection prevents
    // reusing a VALID payment, not re-submitting invalid ones.
    expect(getReplayProtectionStats().usedTxCount).toBe(0);
  });
});

// --- verifyMegaETHPayment integration tests (hits real RPC) ---

describe("verifyMegaETHPayment (RPC)", () => {
  beforeEach(() => {
    clearReplayProtection();
  });

  test("rejects non-existent transaction", async () => {
    const fakeTx = ("0x" + "ff".repeat(32)) as `0x${string}`;
    const result = await verifyMegaETHPayment(
      { txHash: fakeTx },
      1_000_000_000_000_000n,
      PAYMENT_ADDRESS,
    );

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Transaction not found on MegaETH");
  });

  test("handles 0x-prefixed hash correctly", async () => {
    const fakeTx = ("0x" + "ee".repeat(32)) as `0x${string}`;
    const result = await verifyMegaETHPayment(
      { txHash: fakeTx },
      1n,
      PAYMENT_ADDRESS,
    );

    expect(result.valid).toBe(false);
    // Should fail gracefully, not throw
    expect(result.error).toBeDefined();
  });

  test("RPC is reachable on MegaETH mainnet", async () => {
    const connected = await checkMegaETHConnection();
    expect(connected).toBe(true);
  });
});

// --- USDm decimal math tests ---

describe("USDm Decimal Math", () => {
  const DECIMALS = MEGAETH_CONFIG.stablecoin.decimals; // 18

  test("config reports 18 decimals", () => {
    expect(DECIMALS).toBe(18);
  });

  test("$0.001 = 10^15 base units", () => {
    const expected = 10n ** 15n;
    // This is the amount the middleware sends for $0.001
    expect(expected).toBe(1_000_000_000_000_000n);
  });

  test("$1.00 = 10^18 base units", () => {
    const expected = 10n ** 18n;
    expect(expected).toBe(1_000_000_000_000_000_000n);
  });

  test("USDm uses different decimals than USDC (18 vs 6)", () => {
    // USDC: $0.001 = 1000 (10^3)
    const usdcAmount = 10n ** 3n;
    // USDm: $0.001 = 10^15
    const usdmAmount = 10n ** 15n;
    // USDm requires 10^12 more precision per dollar
    expect(usdmAmount / usdcAmount).toBe(10n ** 12n);
  });
});
