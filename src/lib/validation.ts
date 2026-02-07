import { URL } from "url";
import { resolve4, resolve6 } from "dns/promises";

// --- URL validation (SSRF protection with DNS rebinding defense) ---

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "metadata.google.com",
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true; // malformed = blocked
  const [a, b] = parts;
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 127) return true;                          // 127.0.0.0/8
  if (a === 0) return true;                            // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;                    // loopback
  if (lower.startsWith("fe80:")) return true;          // link-local
  if (lower.startsWith("fd")) return true;             // ULA
  if (lower.startsWith("fc")) return true;             // ULA
  if (lower === "::") return true;                     // unspecified
  return false;
}

export async function isPublicUrl(input: string): Promise<{ valid: true; url: string } | { valid: false; reason: string }> {
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

  // Block URLs with non-standard ports
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { valid: false, reason: "Non-standard ports are not allowed" };
  }

  // DNS resolution check — resolve hostname and verify all IPs are public
  try {
    const [ipv4s, ipv6s] = await Promise.allSettled([
      resolve4(hostname),
      resolve6(hostname),
    ]);

    const resolvedIPs: string[] = [];
    if (ipv4s.status === "fulfilled") resolvedIPs.push(...ipv4s.value);
    if (ipv6s.status === "fulfilled") resolvedIPs.push(...ipv6s.value);

    if (resolvedIPs.length === 0) {
      return { valid: false, reason: "URL hostname does not resolve" };
    }

    for (const ip of resolvedIPs) {
      if (ip.includes(":")) {
        if (isPrivateIPv6(ip)) {
          return { valid: false, reason: "URL resolves to a private/reserved IP" };
        }
      } else {
        if (isPrivateIPv4(ip)) {
          return { valid: false, reason: "URL resolves to a private/reserved IP" };
        }
      }
    }
  } catch {
    return { valid: false, reason: "Failed to resolve URL hostname" };
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
    const msg = err.message;
    if (msg.includes("://") && msg.includes("@")) return fallback;
    if (msg.startsWith("/") || msg.includes("\\")) return fallback;
    if (msg.length > 200) return fallback;
    return msg;
  }
  return fallback;
}

// --- Log truncation ---

/** Truncate a hex hash for safe logging (first 10 + last 6 chars) */
export function truncateHash(hash: string): string {
  if (!hash || hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
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
