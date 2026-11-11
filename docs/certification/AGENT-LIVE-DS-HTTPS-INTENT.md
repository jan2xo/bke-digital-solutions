# BKE live Agent ↔ DS disposable HTTP certification intent

Source base: `e927ab14888c1ac655a035f0b89d1ae030dcd1d5`, draft dependency (not main or release).
Master: https://github.com/jan2xo/bke-digital-solutions/issues/340

Intent: on disposable GitHub Actions compute only, execute a separate .NET consumer process using exact Agent source pinned by SHA against actual Digital Solutions machine-key HTTP route handlers exposed via loopback HTTPS with disposable PostgreSQL. Verify signed ENROLL, active metadata, authenticated REVOKE, terminal state, and unauthorized requests.

Minimum exact-head required graph: `pr core licensing native-account identity prisma-isolation`.
Cross-repo: exact SHA pinned in DS harness; Agent Windows DPAPI source certification remains authoritative for Windows key custody; this Linux cross-process signer is isolated to friend assembly for network contract test, never a production key store.

Security: no public listeners, no TLS validation bypass in production, no secrets/prod credentials, no real PayMongo/Resend, no published release, no Agent production registration automation, no JWS/lease product entitlement issuance. No production DB mutation or deployment. No merge while upstream draft dependencies and stolen-bearer enrollment provenance unresolved.

Not required: Commerce, payments, Launcher, installer/UTM/VM, software product binary, signing cutover, production.
