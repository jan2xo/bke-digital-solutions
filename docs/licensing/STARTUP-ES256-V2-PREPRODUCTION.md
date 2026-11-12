# Digital Solutions: versioned ES256 installed-startup key / attestation contract (PREPRODUCTION)

**Intent:** establish a **separate, explicitly versioned** machine-signature protocol for future TPM machine-store ES256 startup attestation. Do not relabel existing software DPAPI Ed25519 startup keys as hardware-protected, do not weaken Ed25519 v1 verifier or allow algorithm substitution. Source-only trust registry remains independent of customer login and commercial licensing.

Upstream: verified Agent main `1bf1a6f7048918f6a19265f94f687d750bb01931` has a certification-only machine-store TPM ES256 probe [#136](https://github.com/jan2xo/bke-licensing-agent/pull/136); **no actual installed privileged TPM signing transport and no physical TPM hardware proof**. Existing exact DPAPI/Ed25519 interop proof [#134](https://github.com/jan2xo/bke-licensing-agent/pull/134) remains valid. Pinned DS base `0be43d74d45b6a24307ddb626a6fd0d4b70bbba4`.

**Owners:** Digital Solutions canonical startup machine-key enrollment, SQL trust, signed startup policy issuance. The Licensing Agent owns future actual Windows CNG installed-startup signer and Host process identity, not DS.

**Protocol invariants:** distinct `v2` schema+domain, explicit `ES256` in candidate/envelope/payload, canonical public SPKI P-256 and P1363 signatures, prior two distinct active Google-admin SQL actors for activation and terminal revocation, immutable algorithm/PEM/device bindings, independent nonce consume and audit, no Ed25519/ES256 cross-protocol acceptance. **Algorithms are not assurance levels:** a software-created P-256 signing key is not TPM-attested.

**Minimum certification graph:** branch-owned `pr` proof plus `core identity licensing platform prisma-isolation` on exact head; disposable PostgreSQL migration/real SQL checks and negative crypto tests. Not required: payments, commerce, catalog, entitlements, launcher/Agent native/installer, signing release, real hardware. Widen if shared trust effects arise. No full DS suite solely due cross-repo participation.

**Production LOCKED:** no deployment/production DB mutation, no new HTTP routes or real Google/admin approvals, no PayMongo/Resend, production signing or release, installer or catalog activation, force push. Retain preproduction-only existing wrappers and feature flags.

**Acceptance here:** source-level versioned ES256 startup public-key trust and DS issuer proof using disposable software-generated ES256 vectors. NOT physical TPM, EK/AIK attestation, registered installed customer Agent, actual Windows CNG machine key, or product direct-EXE E2E. Maintain Agent issue #130 OPEN.
