# DS L3 account-product lease: pre-signing claims authority (source only)

**Source ownership:** DS #340. **Status:** IMPLEMENTATION PENDING. **NO signing endpoint, no live signing keys, no package publication and no production.

**Stacked base:** DS #343 `bea3e223b50dcbfaae294631178cb0f948893e66` (exact-head certified 7/7); #343 is based on DS #341 (6/6 L2 source proof), both draft/unmerged. Shared @bke/licensing account-product JWS contract PR #90 `03dfbbae3a5e4acc95b82e323940555d85cdcf42` and Agent .NET verifier PR #120 `5895f574b77e8c263cd452e6a713045b15e0ecad` are draft/unreleased. DS production package pins @bke/licensing 0.9.0, which lacks the new product JWS issuer.

**Intent:** prepare exactly one strict v1 product execution lease claims object from a previously authorized server-owned L2 decision and a separately proven trusted Agent key/session registration. Hard expiry is capped by both 5-minute policy and every underlying right/key expiry; renewal hint is never the authorization deadline. Derive SHA-256 SPKI thumbprint, require fresh proof, match account/user/session/registered key and never assert TPM attestation without real hardware proof. No JWS is issued in this wave.

**Minimum complete certification graph:** DS `pr + core + licensing + entitlements + catalog + native-account` at exact head, intentionally triggered by trusted `/certify` comment; no payments/commerce, upstream library, Agent/Launcher binaries, installer/UTM, production, publication or signer key custody workflows because their behavior is unchanged.

**Outstanding security gates:** actual DS machine-key enrollment with proof-of-possession and trusted registration, signer key custody/rotation, lease issuance/denial audit within transactional lifecycle, immutable @bke/licensing contract release+repin, authenticated route + rate limiting, Agent/product end-to-end signed verification and clock rollback protections. Do not mistake an input record marking a proof as verified for a secure live machine-registration system.

**Production:** LOCKED.

## Implemented source fraction

- `apps/web/agent-sessions/product-lease-issuance-plan.ts`: pure DS-owned pre-signing projection from `ProductLeaseEligibilityDecision` `status=eligible` plus a separately verified machine-key registration/proof record. It does not authenticate the Agent token or query a key registry itself, and therefore MUST NOT be exposed as an issuance API.
- Registration must be ACTIVE, proofState VERIFIED, registration/account/user/session identical to the L2 decision, verification timestamp within 30s (not future), nonexpired registration, same valid Ed25519 public key on registration/proof. Computes canonical `base64url(SHA-256(SPKI DER))` thumbprint. These checks test evidence consistency only; a future trust owner must **cryptographically validate the proof and persist/guard the registration**.
- Only L2-authorized action is placed in `allowedActions` (OPEN or USE), never automatic action escalation.
- Claims are the exact 15 fields of shared `bke.product-lease.v1` source contract in library #90. Issuer `BKE Digital Solutions`, audience `bke-product`. Generates random UUID lease IDs, strict UTC ISO timestamps and independent immutable claims.
- Hard `expiresAt = min(serverNow + 5 minutes, L2 rightsExpireNoLaterThan, Agent registrationValidUntil)`. Must have strictly over 1s of remaining validity. `refreshAfter` uses half the remaining interval and is NOT an authorization deadline.
- All signed `keyProtection` claims are `software` in this wave because a claimed TPM label is not valid hardware attestation. No private key, no JWT/JWS signer, no HTTP API route, no real machine trust, no audit event, no DB mutation or environment flags.
- `tests/agent-session-product-lease-issuance-plan.test.ts` independently exercises contract shape/time/bindings and fail-closed negative cases. This test creates fresh disposable Ed25519 public keys; no test private key or seed is committed.

## Certified vs NOT certified

This is an **issuance-plan policy source-only** fraction. The real JWS signer `issueAccountProductLeaseJws` remains in **unmerged library PR #90** and must be published immutably only through its separately authorized release intent. Do not vendor/copy/import its unpublished code into DS or assign live key custody to the Agent/Launcher. DS service/route that obtains token-derived L2 evidence and genuine machine-key proof, signs, transactionally audits and returns a JWS has **NOT** been implemented. The C# Agent and product verifier runtime also remain separate.

## Intentional certification

**Required:** `pr core licensing entitlements catalog native-account` at current exact head. The PR-scoped suites cover the pre-signing projection plus existing L2/Agent account/gift boundaries; Core covers typecheck/security/app/build and disposable DB tests. Real source/key trust and published signed JWS are **NOT** proven and will require a separate certification graph when their owners are implemented.

**Not required:** Commerce/Payments/PayMongo/Resend, upstream library source workflows (no changes), Agent/Launcher binaries, Windows/UTM/installer, packages/releases, production host/signing or software catalog. Trigger only with the trusted PR comment; no automatic heavy CI.

**No merge** while stacked licensing source PRs #341/#343 and shared JWS/Agent consumer remain draft and issuer route/key authority unresolved. Production remains LOCKED.
