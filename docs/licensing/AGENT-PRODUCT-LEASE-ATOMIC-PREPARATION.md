# BKE account-product lease: atomic proof → pre-sign audit (source only)

**Authority:** Digital Solutions #340 / Wave 1. **Source baseline:** DS #357 merged `305202a23854f5a33407efdba80730d102c6a037`.
**Unchanged upstream:** JWS library merged source `bke-libraries-typescript@bade2f348a54086c368b9afedfb8769dfa85f9fd`, candidate package 0.10.0 **unpublished**. Agent source unchanged.

## Behavior owned here

`verifyAndAuditAgentProductLeasePreparation(input, now)` is a server-only composition and **not a route**. It owns one Prisma `Serializable` transaction with a bounded timeout:
1. Using the authenticated Agent bearer and the existing DS EdDSA/ES256 nonce challenge verifier, require `expectedPurpose: "LEASE"` under the locked challenge/registration row **before** nonce burn. ENROLL is not a product execution proof and must never activate enrollment through this path.
2. A cryptographically verified one-use LEASE proof is passed directly, without JSON serialization, into the existing live server-owned entitlement/registered public-key gate.
3. The existing audit composition writes `AGENT_PRODUCT_LEASE_PREPARED` (not ISSUED) or `AGENT_PRODUCT_LEASE_PREPARATION_DENIED` in the **same** transaction. Proof failures are recorded as typed denials with no caller-account attribution.
4. The operation returns only after transaction commit. On an audit failure or commit failure, no prepared claims are returned. There are no implicit retries of consumed or failed Agent challenges.

The proof authority's optional internal `expectedPurpose: "LEASE"` option is checked before `consumedAt` UPDATE, preserving existing public ENROLL behavior. The already default-off Agent key HTTP handler and unconditional production 404 remain unchanged.

## Security limits (fail closed)

No product JWS signing, real DS private-key custody/rotation, ISSUED audit, HTTP issuance endpoint, product trust-anchor verification, installed Agent/Launcher, non-exportable TPM proof or production cutover. PREPARED is an unsigned intermediate result and does **not** authorize execution. A future signer must integrate immutable released `@bke/licensing` within the same transaction and append an ISSUED audit only after generating a verifiable JWS, without returning the JWS before commit.

The proof verifier is not TPM attestation. No bearer, pepper, original device code, nonce, signature or private/public key is persisted in denial audit. A SERIALIZABLE rollback reverts DB nonce consumption; any in-memory one-use markers should be treated as a conservative fail-closed cache, never durable proof.

## Exact-head certification

Minimum complete DS graph: `pr core licensing native-account identity entitlements prisma-isolation` (7 targets). Scoped tests cover same-transaction delegation, ENROLL purpose refusal before consumption, typed denial, audit and commit errors, and no exposure of raw credentials. Existing core and native-account/Prisma tests cover database/migration/security. No upstream code changed or packaging/installer/UTM proof is implied.

**Production and package publication: LOCKED.**
