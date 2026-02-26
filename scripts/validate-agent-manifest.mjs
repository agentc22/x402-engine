#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const schemaPath = path.join(repoRoot, "manifest", "agent-manifest.schema.v1.json");
const manifestPath = path.join(repoRoot, "manifest", "agent-manifest.v1.json");

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function fail(errors) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const errors = [];

const topRequired = schema.required;
const endpointRequired = schema.$defs.endpoint.required;
const exampleRequired = schema.$defs.example.required;

if (!isObject(manifest)) errors.push("Manifest must be a JSON object");

const manifestKeys = Object.keys(manifest).sort();
const allowedTopKeys = Object.keys(schema.properties).sort();
if (JSON.stringify(manifestKeys) !== JSON.stringify(allowedTopKeys)) {
  errors.push(`Top-level keys mismatch. Expected exactly: ${allowedTopKeys.join(", ")}`);
}

for (const key of topRequired) {
  if (!(key in manifest)) errors.push(`Missing top-level required key: ${key}`);
}

if (manifest.schema_version !== "agent-manifest.v1") {
  errors.push("schema_version must be 'agent-manifest.v1'");
}

if (!isObject(manifest.service) || typeof manifest.service.name !== "string" || typeof manifest.service.base_url !== "string") {
  errors.push("service must include string name and base_url");
}

if (!isIsoDateTime(manifest.generated_at)) {
  errors.push("generated_at must be ISO date-time");
}

if (!Array.isArray(manifest.endpoints) || manifest.endpoints.length === 0) {
  errors.push("endpoints must be a non-empty array");
} else {
  const seen = new Set();
  const ids = manifest.endpoints.map((e) => e.id);
  const sortedIds = [...ids].sort();
  if (JSON.stringify(ids) !== JSON.stringify(sortedIds)) {
    errors.push("endpoints must be deterministically sorted by id");
  }

  for (const endpoint of manifest.endpoints) {
    if (!isObject(endpoint)) {
      errors.push("each endpoint must be an object");
      continue;
    }

    const endpointKeys = Object.keys(endpoint).sort();
    const expectedKeys = [...endpointRequired].sort();
    if (JSON.stringify(endpointKeys) !== JSON.stringify(expectedKeys)) {
      errors.push(`endpoint '${endpoint.id || "<unknown>"}' must contain only required keys`);
    }

    for (const key of endpointRequired) {
      if (!(key in endpoint)) {
        errors.push(`endpoint '${endpoint.id || "<unknown>"}' missing key '${key}'`);
      }
    }

    if (typeof endpoint.id !== "string" || endpoint.id.length === 0) {
      errors.push("endpoint id must be a non-empty string");
    } else {
      if (seen.has(endpoint.id)) errors.push(`duplicate endpoint id: ${endpoint.id}`);
      seen.add(endpoint.id);
    }

    if (typeof endpoint.path !== "string" || !endpoint.path.startsWith("/")) {
      errors.push(`endpoint '${endpoint.id}' path must start with '/'`);
    }

    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(endpoint.method)) {
      errors.push(`endpoint '${endpoint.id}' has invalid method '${endpoint.method}'`);
    }

    if (typeof endpoint.price !== "string" || !/^\$[0-9]+(\.[0-9]+)?$/.test(endpoint.price)) {
      errors.push(`endpoint '${endpoint.id}' has invalid price '${endpoint.price}'`);
    }

    if (!isObject(endpoint.final_cost) || endpoint.final_cost.currency !== "USD" || typeof endpoint.final_cost.amount !== "number") {
      errors.push(`endpoint '${endpoint.id}' final_cost is invalid`);
    }

    if (!isObject(endpoint.latency) || !Number.isInteger(endpoint.latency.p50_ms) || !Number.isInteger(endpoint.latency.p95_ms) || !Number.isInteger(endpoint.latency.timeout_ms)) {
      errors.push(`endpoint '${endpoint.id}' latency must include integer p50_ms, p95_ms, timeout_ms`);
    }

    if (!isObject(endpoint.uptime_slo) || typeof endpoint.uptime_slo.target_pct !== "number" || !Number.isInteger(endpoint.uptime_slo.window_days)) {
      errors.push(`endpoint '${endpoint.id}' uptime_slo is invalid`);
    }

    if (!/^(idempotent|non_idempotent|conditionally_idempotent)$/.test(endpoint.idempotency)) {
      errors.push(`endpoint '${endpoint.id}' idempotency is invalid`);
    }

    if (!isObject(endpoint.determinism) || !/^(high|medium|low)$/.test(endpoint.determinism.level || "")) {
      errors.push(`endpoint '${endpoint.id}' determinism is invalid`);
    }

    if (!isObject(endpoint.refund_policy) || typeof endpoint.refund_policy.policy !== "string") {
      errors.push(`endpoint '${endpoint.id}' refund_policy is invalid`);
    }

    if (!Array.isArray(endpoint.fallback_equivalents)) {
      errors.push(`endpoint '${endpoint.id}' fallback_equivalents must be array`);
    } else {
      const sortedFallbacks = [...endpoint.fallback_equivalents].sort();
      if (JSON.stringify(endpoint.fallback_equivalents) !== JSON.stringify(sortedFallbacks)) {
        errors.push(`endpoint '${endpoint.id}' fallback_equivalents must be sorted`);
      }
    }

    if (!Array.isArray(endpoint.network_support) || endpoint.network_support.length === 0) {
      errors.push(`endpoint '${endpoint.id}' network_support must be non-empty array`);
    } else {
      const sortedNetworks = [...endpoint.network_support].sort();
      if (JSON.stringify(endpoint.network_support) !== JSON.stringify(sortedNetworks)) {
        errors.push(`endpoint '${endpoint.id}' network_support must be sorted`);
      }
    }

    if (!Array.isArray(endpoint.error_taxonomy) || endpoint.error_taxonomy.length === 0) {
      errors.push(`endpoint '${endpoint.id}' error_taxonomy must be non-empty array`);
    }

    if (!isIsoDateTime(endpoint.last_verified_at)) {
      errors.push(`endpoint '${endpoint.id}' last_verified_at must be ISO date-time`);
    }
  }
}

if (!isObject(manifest.examples)) {
  errors.push("examples must be an object");
} else {
  const exampleKeys = Object.keys(manifest.examples).sort();
  if (JSON.stringify(exampleKeys) !== JSON.stringify(["crypto-price", "wallet-balances"])) {
    errors.push("examples must include exactly 'crypto-price' and 'wallet-balances'");
  }

  for (const [key, value] of Object.entries(manifest.examples)) {
    if (!isObject(value)) {
      errors.push(`example '${key}' must be an object`);
      continue;
    }
    for (const requiredKey of exampleRequired) {
      if (!(requiredKey in value)) errors.push(`example '${key}' missing '${requiredKey}'`);
    }
  }
}

if (errors.length > 0) fail(errors);
console.log(`validated ${manifestPath} (${manifest.endpoints.length} endpoints)`);
