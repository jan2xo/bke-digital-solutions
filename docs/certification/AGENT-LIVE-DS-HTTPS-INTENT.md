# BKE live Agent ↔ DS disposable HTTP certification intent

Source base: `e927ab14888c1ac655a035f0b89d1ae030dcd1d5`, draft dependency (not main or release).
Master: https://github.com/jan2xo/bke-digital-solutions/issues/340

Intent: on disposable GitHub Actions compute only, execute a separate .NET consumer process using exact Agent source pinned by SHA against actual Digital Solutions machine-key HTTP route handlers exposed via loopback HTTPS with disposable PostgreSQL. Verify signed ENROLL, active metadata, authenticated REVOKE, terminal state, and unauthorized requests.

Minimum exact-head required graph: `pr core licensing native-account identity prisma-isolation`.
Cross-repo: exact SHA pinned in DS harness; Agent Windows DPAPI source certification remains authoritative for Windows key custody; this Linux cross-process signer is isolated to friend assembly for network contract test, never a production key store.

Security: no public listeners, no TLS validation bypass in production, no secrets/prod credentials, no real PayMongo/Resend, no published release, no Agent production registration automation, no JWS/lease product entitlement issuance. No production DB mutation or deployment. No merge while upstream draft dependencies and stolen-bearer enrollment provenance unresolved.

Not required: Commerce, payments, Launcher, installer/UTM/VM, software product binary, signing cutover, production.


## Reconciliation — EdDSA and ES256 exact SHA (2026-11-12 PHT)

- **DS upstream** [#348](https://github.com/jan2xo/bke-digital-solutions/pull/348) `3ecece126b83afe095210f5dbef6bf2be6601bd5` (6/6 source certified, unmerged).
- **Agent consumer** [#125](https://github.com/jan2xo/bke-licensing-agent/pull/125) `b4ca67fc4624693afa324ac4f4fa3a78bb76fab0` (new Windows exact-head certification pending).
- Test fetches exact Agent source SHA, launches two separate .NET processes using disposable Ed25519 and NIST P-256 ephemeral software keys, each against independently authenticated disposable Agent session and exact real DS POST handlers, transactional PostgreSQL and pinned local TLS certificate. EdDSA/ES256 verify server-returned algorithm and exact SPKI thumbprint; ES256 signatures are 64-byte IEEE-P1363. Neither signer claims TPM hardware. The second session is distinct so server terminal revoke is never silently rotated.
- **Required:** `pr core licensing native-account identity prisma-isolation`; Agent `contracts windows-x64`. **Not required:** payments, commerce, release, installer/UTM, production DB/web deploy, signing key cutover. This branch still has no full deployed Next/Workers service or physical Windows TPM E2E.
