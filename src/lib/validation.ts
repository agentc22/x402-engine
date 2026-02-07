import { URL } from "url";

// --- URL validation (SSRF protection) ---

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "metadata.google.com",
]);

const BLOCKED_IP_PREFIXES = [
  "10.",        // RFC 1918
  "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.",
  "172.24.", "172.25.", "172.26.", "172.27.",
  "172.28.", "172.29.", "172.30.", "172.31.",
  "192.168.",   // RFC 1918
  "169.254.",   // Link-local / cloud metadata
  "0.",
  "fd",         // IPv6 ULA
  "fe80:",      // IPv6 link-local
];

export function isPublicUrl(input: string): { valid: true; url: string } | { valid: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { valid: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, reason: "Only HTTP/HTTPS URLs are allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, reason: "URL points to a blocked host" };
  }

  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      return { valid: false, reason: "URL points to a private/reserved IP" };
    }
  }

  // Block URLs with ports that aren't standard
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { valid: false, reason: "Non-standard ports are not allowed" };
  }

  return { valid: true, url: parsed.toString() };
}

// --- Input sanitization ---

/** Alphanumeric + dashes + underscores only (for IDs, slugs) */
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

/** Comma-separated safe IDs */
const SAFE_CSV = /^[a-zA-Z0-9_,-]+$/;

/** Ethereum address */
const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Solana address (base58, 32-87 chars) */
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,87}$/;

/** Chain name (lowercase alphanumeric + dashes) */
const CHAIN_NAME = /^[a-z0-9-]+$/;

/** IPFS CID (v0: Qm..., v1: bafy...) */
const IPFS_CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

export function validateIds(input: string): string[] | null {
  if (!SAFE_CSV.test(input)) return null;
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}

export function validateCurrencies(input: string): string[] | null {
  if (!SAFE_CSV.test(input)) return null;
  return input.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isValidEthAddress(addr: string): boolean {
  return ETH_ADDRESS.test(addr);
}

export function isValidSolAddress(addr: string): boolean {
  return SOL_ADDRESS.test(addr);
}

export function isValidChain(chain: string): boolean {
  return CHAIN_NAME.test(chain) && chain.length <= 30;
}

export function isValidCid(cid: string): boolean {
  return IPFS_CID.test(cid);
}

export function isValidId(id: string): boolean {
  return SAFE_ID.test(id) && id.length <= 100;
}

export function clampInt(val: string | undefined, min: number, max: number, fallback: number): number {
  if (!val) return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// --- Safe error messages ---

export function safeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    // Strip anything that looks like a URL with credentials or a file path
    const msg = err.message;
    if (msg.includes("://") && msg.includes("@")) return fallback;
    if (msg.startsWith("/") || msg.includes("\\")) return fallback;
    // Limit length
    if (msg.length > 200) return fallback;
    return msg;
  }
  return fallback;
}

// --- Price conversion (string-based, no floating-point) ---

/**
 * Convert "$0.001" to token units with the given number of decimals.
 * Uses pure string arithmetic — no parseFloat.
 */
export function priceStringToTokenAmount(price: string, decimals: number): bigint {
  const stripped = price.startsWith("$") ? price.slice(1) : price;
  const [intPart = "0", decPart = ""] = stripped.split(".");
  const padded = decPart.padEnd(decimals, "0").slice(0, decimals);
  const tokenStr = (intPart + padded).replace(/^0+/, "") || "0";
  return BigInt(tokenStr);
}
