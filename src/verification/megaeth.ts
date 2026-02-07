import {
  createPublicClient,
  http,
  defineChain,
  parseEventLogs,
  type Hex,
  type TransactionReceipt,
  type Log,
} from "viem";
import { MEGAETH_CONFIG } from "../config/chains.js";

// --- Chain definition for viem ---

const megaeth = defineChain({
  id: MEGAETH_CONFIG.chainId,
  name: MEGAETH_CONFIG.displayName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [MEGAETH_CONFIG.rpc] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: MEGAETH_CONFIG.explorer },
  },
});

const client = createPublicClient({
  chain: megaeth,
  transport: http(MEGAETH_CONFIG.rpc),
});

// --- ERC-20 Transfer event ABI ---

const erc20TransferAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

// --- Replay protection ---
// In-memory set of already-used tx hashes. In production, move to SQLite.
const usedTxHashes = new Set<string>();

// --- Types ---

export interface PaymentProof {
  txHash: Hex;
  receipt?: TransactionReceipt;
}

export interface VerificationResult {
  valid: boolean;
  payer?: string;
  txHash?: string;
  error?: string;
}

// --- Core verification ---

/**
 * Verifies a MegaETH USDm payment by checking the transaction receipt
 * for a Transfer event to the expected recipient with sufficient amount.
 *
 * Flow:
 * 1. Client sends USDm transfer via eth_sendRawTransactionSync (instant receipt)
 * 2. Client includes txHash in payment proof
 * 3. We fetch the receipt (instant on MegaETH) and verify Transfer logs
 */
export async function verifyMegaETHPayment(
  proof: PaymentProof,
  expectedAmount: bigint,
  expectedRecipient: string,
): Promise<VerificationResult> {
  const txHash = proof.txHash.toLowerCase() as Hex;

  // Replay protection
  if (usedTxHashes.has(txHash)) {
    return { valid: false, error: "Transaction already used for payment" };
  }

  let receipt: TransactionReceipt;

  if (proof.receipt) {
    // Client provided the receipt inline (MegaETH instant receipt flow).
    // We still verify it on-chain to prevent forged receipts.
    receipt = proof.receipt;

    // Sanity check: receipt txHash must match claimed txHash
    if (receipt.transactionHash.toLowerCase() !== txHash) {
      return { valid: false, error: "Receipt txHash mismatch" };
    }
  }

  // Always fetch from chain — even if receipt was provided — to prevent forgery
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return { valid: false, error: "Transaction not found on MegaETH" };
  }

  // Check tx succeeded
  if (receipt.status !== "success") {
    return { valid: false, error: "Transaction reverted" };
  }

  // Check chain ID via the receipt's block existence on our client
  // (the client is configured for chain 4326, so if getTransactionReceipt
  // succeeded, the tx is on the right chain)

  // Find USDm Transfer events
  const result = verifyTransferLogs(
    receipt.logs,
    expectedAmount,
    expectedRecipient,
  );

  if (result.valid) {
    // Mark tx as used (replay protection)
    usedTxHashes.add(txHash);
    return {
      valid: true,
      payer: result.payer,
      txHash,
    };
  }

  return result;
}

/**
 * Scans receipt logs for a USDm Transfer event matching the expected
 * recipient and amount.
 */
export function verifyTransferLogs(
  logs: Log[],
  expectedAmount: bigint,
  expectedRecipient: string,
): VerificationResult {
  const usdmAddress = MEGAETH_CONFIG.stablecoin.address.toLowerCase();

  // Filter to logs from the USDm contract
  const usdmLogs = logs.filter(
    (log) => log.address.toLowerCase() === usdmAddress,
  );

  if (usdmLogs.length === 0) {
    return { valid: false, error: "No USDm transfer found in transaction" };
  }

  // Parse Transfer events
  let transfers;
  try {
    transfers = parseEventLogs({
      abi: erc20TransferAbi,
      logs: usdmLogs,
    });
  } catch {
    return { valid: false, error: "Failed to decode Transfer events" };
  }

  if (transfers.length === 0) {
    return { valid: false, error: "No Transfer events from USDm contract" };
  }

  // Find a Transfer to the expected recipient with sufficient amount.
  // Sum all transfers to the recipient (in case of split payments).
  let totalToRecipient = 0n;
  let payer: string | undefined;
  const recipientLower = expectedRecipient.toLowerCase();

  for (const transfer of transfers) {
    const to = (transfer.args.to as string).toLowerCase();
    if (to === recipientLower) {
      totalToRecipient += transfer.args.value as bigint;
      payer = transfer.args.from as string;
    }
  }

  if (totalToRecipient === 0n) {
    return {
      valid: false,
      error: `No USDm transfer to expected recipient ${expectedRecipient}`,
    };
  }

  if (totalToRecipient < expectedAmount) {
    return {
      valid: false,
      error: `Insufficient amount: got ${totalToRecipient}, expected ${expectedAmount}`,
    };
  }

  return { valid: true, payer };
}

/**
 * Check if MegaETH RPC is reachable.
 */
export async function checkMegaETHConnection(): Promise<boolean> {
  try {
    const chainId = await client.getChainId();
    return chainId === MEGAETH_CONFIG.chainId;
  } catch {
    return false;
  }
}

/**
 * Get the number of used tx hashes (for monitoring).
 */
export function getReplayProtectionStats(): { usedTxCount: number } {
  return { usedTxCount: usedTxHashes.size };
}

/**
 * Clear replay protection set. For testing only.
 */
export function clearReplayProtection(): void {
  usedTxHashes.clear();
}
