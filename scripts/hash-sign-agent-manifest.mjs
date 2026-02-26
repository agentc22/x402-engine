#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifestPath = path.join(repoRoot, "manifest", "agent-manifest.v1.json");
const outputPath = path.join(repoRoot, "manifest", "agent-manifest.integrity.v1.json");

const payload = fs.readFileSync(manifestPath);
const sha256 = crypto.createHash("sha256").update(payload).digest("hex");

let publicKeyBase64 = "REPLACE_WITH_ED25519_PUBLIC_KEY_BASE64";
let signatureBase64 = "REPLACE_WITH_ED25519_SIGNATURE_BASE64";
let signedAt = process.env.SIGNING_TIMESTAMP || "REPLACE_WITH_SIGNING_TIMESTAMP";

const privateKeyPem = process.env.AGENT_MANIFEST_ED25519_PRIVATE_KEY_PEM;
if (privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const signature = crypto.sign(null, Buffer.from(sha256, "utf8"), privateKey);
  publicKeyBase64 = Buffer.from(publicKeyDer).toString("base64");
  signatureBase64 = signature.toString("base64");
  signedAt = process.env.SIGNING_TIMESTAMP || new Date().toISOString();
}

const integrity = {
  schema_version: "agent-manifest-integrity.v1",
  manifest_path: "manifest/agent-manifest.v1.json",
  hash: {
    algorithm: "sha256",
    value: sha256
  },
  signature: {
    algorithm: "ed25519",
    public_key_base64: publicKeyBase64,
    signature_base64: signatureBase64
  },
  signed_at: signedAt,
  notes: privateKeyPem
    ? "Signed with AGENT_MANIFEST_ED25519_PRIVATE_KEY_PEM"
    : "Scaffold placeholders only. Set AGENT_MANIFEST_ED25519_PRIVATE_KEY_PEM to produce real signature."
};

fs.writeFileSync(outputPath, JSON.stringify(integrity, null, 2) + "\n", "utf8");
console.log(`wrote ${outputPath}`);
console.log(`sha256 ${sha256}`);
