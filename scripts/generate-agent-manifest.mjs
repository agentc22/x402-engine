#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const servicesPath = path.join(repoRoot, "config", "services.json");
const catalogPath = path.join(repoRoot, "manifest", "agent-manifest.catalog.v1.json");
const outputPath = path.join(repoRoot, "manifest", "agent-manifest.v1.json");

function parsePriceToNumber(price) {
  if (typeof price !== "string" || !price.startsWith("$")) {
    throw new Error(`Invalid price format: ${price}`);
  }
  const value = Number(price.slice(1));
  if (!Number.isFinite(value)) throw new Error(`Non-numeric price: ${price}`);
  return value;
}

function stableSortObject(input) {
  if (Array.isArray(input)) return input.map(stableSortObject);
  if (input && typeof input === "object") {
    const out = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = stableSortObject(input[key]);
    }
    return out;
  }
  return input;
}

function stableJSONStringify(input) {
  return JSON.stringify(stableSortObject(input), null, 2) + "\n";
}

function pickProfile(service, catalog) {
  const p = service.path;
  const rules = catalog.profile_rules;
  if (rules.compute_path_prefixes.some((prefix) => p.startsWith(prefix))) return "compute";
  if (rules.storage_write_path_prefixes.some((prefix) => p.startsWith(prefix))) return "storage_write";
  if (service.method === "GET") return "read_get";
  if (rules.read_post_path_prefixes.some((prefix) => p.startsWith(prefix))) return "read_post";
  return "compute";
}

function defaultFallbacks(service, servicesByCategory) {
  const peers = (servicesByCategory.get(service.category || "uncategorized") || [])
    .map((s) => s.id)
    .filter((id) => id !== service.id)
    .sort();
  return peers.slice(0, 2);
}

const servicesRaw = JSON.parse(fs.readFileSync(servicesPath, "utf8"));
const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const services = [...servicesRaw.services].sort((a, b) => a.id.localeCompare(b.id));

const servicesByCategory = new Map();
for (const service of services) {
  const key = service.category || "uncategorized";
  if (!servicesByCategory.has(key)) servicesByCategory.set(key, []);
  servicesByCategory.get(key).push(service);
}

const endpoints = services.map((service) => {
  const profileName = pickProfile(service, catalog);
  const profile = catalog.profiles[profileName];
  if (!profile) throw new Error(`Profile '${profileName}' not found for ${service.id}`);

  const override = catalog.endpoint_overrides?.[service.id] || {};
  const endpointId = override.id || service.id;

  const endpoint = {
    id: endpointId,
    path: service.path,
    method: service.method,
    price: service.price,
    final_cost: {
      ...catalog.defaults.final_cost,
      amount: parsePriceToNumber(service.price)
    },
    latency: { ...profile.latency },
    uptime_slo: { ...catalog.defaults.uptime_slo },
    idempotency: profile.idempotency,
    determinism: { ...profile.determinism },
    refund_policy: { ...catalog.defaults.refund_policy },
    fallback_equivalents: defaultFallbacks(service, servicesByCategory),
    network_support: [...catalog.defaults.network_support],
    error_taxonomy: [...catalog.defaults.error_taxonomy],
    last_verified_at: catalog.defaults.last_verified_at
  };

  if (override.fallback_equivalents) {
    endpoint.fallback_equivalents = [...override.fallback_equivalents];
  }
  if (override.determinism) {
    endpoint.determinism = { ...override.determinism };
  }

  endpoint.fallback_equivalents = [...new Set(endpoint.fallback_equivalents)].sort();
  endpoint.network_support = [...new Set(endpoint.network_support)].sort();
  endpoint.error_taxonomy = endpoint.error_taxonomy
    .map((e) => ({ ...e }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return endpoint;
}).sort((a, b) => a.id.localeCompare(b.id));

const manifest = {
  schema_version: catalog.manifest_schema_version,
  manifest_id: catalog.manifest_id,
  service: {
    name: catalog.service.name,
    base_url: catalog.service.base_url
  },
  generated_at: process.env.MANIFEST_GENERATED_AT || catalog.generated_at,
  endpoints,
  examples: catalog.examples
};

fs.writeFileSync(outputPath, stableJSONStringify(manifest), "utf8");
console.log(`generated ${outputPath} (${endpoints.length} endpoints)`);
