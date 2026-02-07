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
import { isTxHashUsed, recordTxHash } from "../db/ledger.js";

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
  transport: http(MEGAETH_CONFIG.rpc, { timeout: 15_000 }),
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
 * Replay protection uses PostgreSQL (persistent across restarts).
 */
export async function verifyMegaETHPayment(
  proof: PaymentProof,
  expectedAmount: bigint,
  expectedRecipient: string,
): Promise<VerificationResult> {
  const txHash = proof.txHash.toLowerCase() as Hex;

  // Validate recipient address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(expectedRecipient)) {
    return { valid: false, error: "Invalid recipient address format" };
  }

  // Replay protection — check PostgreSQL
  const alreadyUsed = await isTxHashUsed(txHash);
  if (alreadyUsed) {
    return { valid: false, error: "Transaction already used for payment" };
  }

  // Always fetch receipt from chain — never trust client-provided receipts
  let receipt: TransactionReceipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch {
    return { valid: false, error: "Transaction not found on MegaETH" };
  }

  // Validate receipt structure
  if (!receipt || !receipt.logs || !Array.isArray(receipt.logs)) {
    return { valid: false, error: "Invalid transaction receipt" };
  }

  // Check tx succeeded
  if (receipt.status !== "success") {
    return { valid: false, error: "Transaction reverted" };
  }

  // Find USDm Transfer events
  const result = verifyTransferLogs(
    receipt.logs,
    expectedAmount,
    expectedRecipient,
  );

  if (result.valid) {
    // Atomically record tx hash — if this returns false, another request beat us
    const inserted = await recordTxHash(txHash, result.payer, expectedAmount.toString(), MEGAETH_CONFIG.caip2);
    if (!inserted) {
      return { valid: false, error: "Transaction already used for payment (race)" };
    }
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
      error: "No USDm transfer to expected recipient",
    };
  }

  if (totalToRecipient < expectedAmount) {
    return {
      valid: false,
      error: "Insufficient payment amount",
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
