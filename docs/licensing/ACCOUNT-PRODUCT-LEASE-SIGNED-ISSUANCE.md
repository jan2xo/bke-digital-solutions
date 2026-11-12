# Agent account-product JWS issuance — preproduction-only trust plan

**Certification intent:** complete the existing authenticated Agent LEASE challenge → live account entitlement/registered machine key → Ed25519 JWS signing → atomic ISSUED audit in one Serializable transaction. Public Agent-only adapters remain disabled by default and unconditionally unavailable in production. This is distinct from the existing commercial license-key protocol, which requires no Google login.

## Invariants

- Only Digital Solutions issues account-product JWS; use the pinned immutable @bke/licensing 0.10.0 Ed25519 provider and v1 claims schema. Do not recreate or rewrite the library.
- Authentication via existing Agent session bearer, never caller-asserted accountId/userId/sessionId. A fresh one-use LEASE challenge and real Ed25519/ES256 possession signature must bind action/product/account/machine and be consumed inside the same database transaction as issuance.
- Live catalog `ACCOUNT` or `EITHER`, active paid/trial rights and registration row locked before signing. `LICENSE_KEY` rejects account JWS while commercial signed lease issuance remains Google-free.
- Dedicated SQL-owned key registry: key ID, ACTIVE / VERIFY_ONLY / REVOKED state and public PEM only; signing private PEM is supplied by a separate server-secret map, never persisted, logged or returned. Exactly one ACTIVE row, verify private/public key pair and kid. Rotation retains old VERIFY_ONLY keys for outstanding leases.
- Both signed output and AGENT_PRODUCT_LEASE_ISSUED audit created inside the same bounded Serializable transaction. Return JWS only after commit. A failure in verification, signing, ISSUED audit or commit returns no JWS. No signing key, bearer, raw JWS, original challenge/signature or PEM is included in audit.
- Expose two narrow Agent-only endpoints only in disposable/preproduction: begin LEASE challenge then issue signed JWS. Unconditionally 404 in production, default-off configuration, distributed per-IP and per-bearer rate limits, bounded strict JSON, no browser Origin and exact Agent protocol version.
- No DS production signing cutover, DB mutation, live provider traffic, Agent/Launcher installer acceptance, npm publication, catalog activation or production deploy. Agent installed trust-anchor verification remains a separate certification intent.

## Required proof

Security-owning modules: pr, core, licensing, native-account, identity, entitlements, catalog, prisma-isolation. Core disposable PostgreSQL must apply migration and prove atomic one-use challenge/signing/audit commit and rollback; hermetic crypto and HTTP attack tests must fail closed; key rotation and unknown/mismatched keys must deny. Source changes require fresh exact-head certification before SHA-locked merge.

**GitHub source authority:** previous DS main 4860529c229bdf4398ebeebf09bf35f05be8c1d5; last dual-path policy PR #361 certified/merged; upstream immutable Licensing release `licensing-v0.10.0`, GitHub release ID 442576730.