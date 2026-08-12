# Supply-chain signing contract

Phase 3 uses the `bke.supply-chain.v1` manifest. The manifest is canonical JSON
with recursively sorted object keys and deterministically sorted artifacts:

```json
{
  "artifacts": [{"contentType":"...","id":"...","objectKey":"...","sha256":"...","sizeBytes":0}],
  "productId": "...",
  "productSlug": "...",
  "schema": "bke.supply-chain.v1",
  "signingKeyId": "...",
  "version": "...",
  "versionId": "..."
}
```

The UTF-8 canonical JSON is signed with Ed25519. Its SHA-256 is the evidence
identity. The server signs only the database's current ProductVersion and
ProductArtifact state, then verifies the result through the trusted public-key
resolver before recording evidence. `SUPPLY_CHAIN_SIGNING_PRIVATE_KEY` is a
server secret and is never stored in PostgreSQL, accepted from clients, logged,
or returned. It is unrelated to `LICENSE_SIGNING_*`, which signs commercial
leases.

`POST /api/admin/supply-chain` with `{ "action": "SIGN", "versionId": "..." }`
requires same-origin, recent administrator authentication, and rate limiting.
The request cannot provide a payload, private key, or arbitrary signer. Signing
the same artifact state and key is idempotent. Replacing an artifact changes the
manifest hash, so old evidence cannot satisfy a new release gate.

Legacy artifact-hash verification records remain historical and are not
reinterpreted as canonical-manifest evidence. Stable/LTS promotion requires
matching canonical signature evidence in addition to existing SBOM, provenance,
dependency, malware, backup, compliance, migration, approval, and separation
gates. Production scanner and certificate provisioning remain deferred work.

Phase 3 certification is PASS (2026-08-13): live signing, independent Ed25519
verification, artifact mutation invalidation, re-signing, idempotency,
authorization, publication signing evidence, and private-key non-exposure.
