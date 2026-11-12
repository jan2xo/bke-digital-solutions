# DS #348 — Agent key registration status/reconciliation (SOURCE ONLY)

**Verified DS dependency:** #346 source merged as `main=3ca39757bc5366b914aaf84f125da54e69662cc3`; attached to DS #340 ledger. Independent Agent consumer not yet installed or runtime-proven.

**Intent:** session-scoped, read-only status to reconcile protected Agent receipt after restart, refused ambiguous registration, wrong account/session/user/device, and terminal revocation; server-derived `EdDSA|ES256` algorithm and public SPKI thumbprint do not grant TPM claims. Never accept client-provided assurance, key algorithm, or private key.

**Security:** POST only, exact Agent protocol and Origin rejection, bearer authentication, strict bounded JSON, IP+bearer distributed fail-closed limits, disposable PostgreSQL SERIALIZABLE read. Existing #346 independent default-off `AGENT_KEY_HTTP_ENABLED` and unconditional production 404 gate apply to **all four operations, including status**; retained by the reconciled adapter and asserted by tests. Public LEASE/JWS signing remain unsupported.

**Declared minimum certification graph:** `pr core licensing native-account identity prisma-isolation` (6 owners). Core includes actual disposable DB, Next, Workers/workerd, containers and security. No host config change: Platform gating is inherited from independently certified #346 and reasserted in PR tests, not re-dispatched. Payments/commerce/catalog/product/Agent/installer/UTM/release/production NOT REQUIRED.

**Cross-repo:** Agent owns machine key, protected receipt and lifecycle. Historical Agent #124 Windows source proof does not establish installed Agent or physical TPM. Actual Agent main/PR ancestry must be reconciled before product activation; no Agent source touched in this DS disabled route wave.

**Source-only SHA-locked merge is authorized only after new exact-head 6/6 proof**, zero unresolved review, and expected-SHA merge. **Production/release locked**: no prod DB, deployment, key signing, PayMongo/Resend, installer/JWS package or catalog publication, or force push.
