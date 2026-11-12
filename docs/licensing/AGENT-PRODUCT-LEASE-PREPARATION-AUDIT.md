# BKE product execution lease — source-only preparation audit

**Owner:** Digital Solutions #340, product authorization Wave 1.
**Dependency:** DS #356 transactional key/entitlement gate on live main; shared @bke/licensing 0.10.0 remains an **unpublished** source candidate.

## Exactly what this wave adds

`prepareAndAuditProductLeaseInTransaction(tx, input, now)` composes the existing authenticated server-owned entitlement + Agent-key proof preparation gate with an AuditLog write **in the same caller-supplied Prisma transaction**. It does not create a JWS, assign customer rights, publish an artifact, implement key custody or expose HTTP.

- **PREPARED:** only after existing gate succeeds, an `AGENT_PRODUCT_LEASE_PREPARED` event records the server-derived actor/account, unique prospective lease ID, product/action, Agent session public-key thumbprint and short hard expiry. PREPARED is **not an ISSUED JWS**.
- **DENIED:** `AGENT_PRODUCT_LEASE_PREPARATION_DENIED` contains only the typed denial reason; account and actor are null. Do not trust request product/account/user values to attribute an unauthenticated denial.
- **Fail closed:** any persistence error rejects the source operation. The future caller must roll back the entire SERIALIZABLE transaction on failure; neither an unsigned claim nor a partially written audit authorizes execution.
- **Secret exclusion:** no bearer, session pepper, device code, nonce, private signing key, public SPKI or raw JWS in the audit metadata. Only server-authenticated, non-secret binding metadata is written.

The authenticated source gate is already responsible for verifying EdDSA/ES256 registration, exact account/user/session/product/action, nonce replay, revocation and expiry. These existing tests remain required in the exact-head certification graph.

## This is NOT the issuance audit

A future *separate* trusted production signing implementation must use a released immutable `@bke/licensing` signer, approved key custody, rotation and policy, then atomically audit **ISSUED** only after actual verifiable JWS creation. It must preserve the same SERIALIZABLE transaction and ensure no JWS is returned before commit. A PREPARED event cannot be taken as evidence of a signature, license issuance or product execution right.

No new schema/migration, environment flag, HTTP route or release. Production & package publication remain locked.
