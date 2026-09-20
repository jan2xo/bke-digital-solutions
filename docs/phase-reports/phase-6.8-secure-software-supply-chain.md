# Phase 6.8 — Secure Software Supply Chain

## Implemented

- CycloneDX SBOM generation from the locked npm dependency graph (`npm run supplychain:sbom`).
- Build provenance generation with commit, branch, release, environment, builder, and timestamp (`npm run supplychain:provenance`). Unknown values remain `unknown`; provenance is never fabricated.
- Release-linked supply-chain evidence with artifact manifest, hashes, SBOM reference, signing state, dependency verification, malware scan state, certificate state, and provenance state.
- Administrator visibility at `/admin/supply-chain` and audited evidence updates through `/api/admin/supply-chain`.

## Explicit pending states

Release signing keys, Windows Authenticode, macOS Developer ID, Linux package certificates, and malware scanning infrastructure are not provisioned by this phase. The dashboard reports these as pending and makes no certification claim.

## Licensing boundary

No Licensing Agent, lease, AuthorizationDecision, signature-verification, or binding architecture was changed.
