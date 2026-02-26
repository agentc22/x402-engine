# Agent Manifest Release Flow (No Publish)

This package is local-only scaffolding for `x402engine` and does **not** publish/deploy anything.

## Files

- `manifest/agent-manifest.schema.v1.json` - strict schema (`agent-manifest.v1`)
- `manifest/agent-manifest.catalog.v1.json` - single source catalog for generation defaults/profiles/examples
- `manifest/agent-manifest.v1.json` - generated full manifest (61 current endpoints)
- `manifest/agent-manifest.integrity.v1.json` - hash + signature scaffold output

## Generate -> Validate -> Hash -> Sign -> Publish

1. Generate

```bash
npm run manifest:generate
```

2. Validate

```bash
npm run manifest:validate
```

3. Hash (always)

```bash
npm run manifest:hash-sign
```

4. Sign (optional, real signature)

```bash
export AGENT_MANIFEST_ED25519_PRIVATE_KEY_PEM="$(cat /secure/path/ed25519-private.pem)"
export SIGNING_TIMESTAMP="2026-02-25T00:00:00Z"
npm run manifest:hash-sign
```

5. Publish (manual, out-of-scope here)

- Publish step is intentionally not automated in this package.
- If/when needed, publish the generated manifest + integrity files via your existing release channel.

## CI policy

CI runs generation and validation and fails if generated artifacts are out of date.

## Coexistence with `llms.txt` and OpenAPI

- `agent-manifest.v1.json` is payment + reliability metadata for agent orchestration and endpoint economics.
- `llms.txt` is model-facing discovery guidance, not authoritative operational SLO/pricing metadata.
- OpenAPI is request/response interface contract; the manifest complements it with cost, determinism, fallback, network support, and refund semantics.
- Keep OpenAPI and `llms.txt` in sync with paths/methods, and treat this manifest as the canonical payment/runtime profile layer.
