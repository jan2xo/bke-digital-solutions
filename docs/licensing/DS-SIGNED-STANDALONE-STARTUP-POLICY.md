# DS-signed standalone startup policy — SQL + machine-proof authority (PREPRODUCTION)

## Intent and immutable cross-repo contract
- Canonical tracking: [Licensing Agent #130](https://github.com/jan2xo/bke-licensing-agent/issues/130).
- DS base `083ef5b46765384e8a442c5700a0cfe746d0dc4f`; Agent verifier merged `5cf43d00c09cbeb42932ec5875ce45e3bd6989ee`; Launcher `b7dc17316574c746c570d33bc603e03b94ac5105`.
- DS owns the **SQL product mode** and signs a **short-lived installed-policy projection**. Agent owns real installed executable/path, user SID, machine identity, privileged policy installation, local process and credential verification. **Key-only startup never requires a Google/account login.**
- This PR is SOURCE/PREPRODUCTION ONLY. It introduces no external HTTP/admin route, signer enrollment UI, private key, customer activation or active installer policy. Production stays locked.

## Two independent verified authorities, one atomic issuance
1. A privileged installed Agent must independently attest the actual Windows executable/installation/user/machine under its protected machine signing key. DS must **not** sign arbitrary caller-supplied `image_path`, `image_sha256`, `allowed_user_sid` or installation ID. A dedicated SQL-owned, PUBLIC-ONLY `AgentStartupAttestationSigningKey` registry is a trust anchor. No registered, unrevoked machine-bound Agent key, or a missing/malformed/replayed/expired Ed25519 attestation, **denies issuance**. This repository does **not** enroll/activate attestation keys or produce those machine proofs; a separate Agent intent must do that.
2. Inside one non-retried SERIALIZABLE transaction, DS locks and reads the published active STANDALONE `Product` + `ProductVersion` + exactly one SQL `ProductActivationPolicy` mode, consumes the unique attestation ID, locks the existing sole ACTIVE `AccountProductLeaseSigningKey`, verifies the supplied env private key matches its public SPKI, and signs the exact cross-repo policy bytes. It writes an `AuditLog` with only nonsecret hashes and metadata. The signed bundle is released **only after COMMIT**. No fallback to licenseType, unsigned manifest, `EITHER`, or an unverified Agent request.
3. The DS signed policy envelope matches [Agent's installed policy verifier](https://github.com/jan2xo/bke-licensing-agent/blob/5cf43d00c09cbeb42932ec5875ce45e3bd6989ee/dotnet/src/BKE.LicensingAgent.Infrastructure/InstalledStandaloneStartupPolicyRegistry.cs): `schema=bke.standalone-startup-envelope.v1`, `kid`, JSON `payload` string, padded canonical base64 `signature`. Signature is Ed25519 over UTF-8 `BKE-STANDALONE-STARTUP-POLICY-V1\n` + that exact payload. Inner schema `bke.standalone-startup-policy.v1`, pinned `issuer_source_sha=09c16bc5c7e1d6ab3cb8df0ba569e6da05498f3f` (the originally certified public DS JWS signer provenance), exact product/version/install/path/sha/user/mode, and canonical .NET `DateTimeOffset("O")` UTC times. No network-delivered keys or private PEM in payload/audit.
4. The Agent signer trust bundle and the DS SQL signer must use **the same certified account-product public issuer**, never a commercial license key. Revocation and missing signed policy must fail closed, not downgrade.

## Feature and authority locks
- New generation-independent DS config `STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED`, default `false`; only eligible with nonproduction DEPLOYMENT_ENV and the existing separate account-product Ed25519 signing keyset.
- Do **not** enable it in production and do not create a customer-facing HTTP endpoint or admin key provisioning UI in this intent.
- A dedicated attestation key registry is admin-controlled PUBLIC-ONLY SQL, no private machine/DS signer material in Postgres.
- No real machine attestation enrollment, signature cutover, production migration or installed customer activation is authorized or claimed. Only disposable CI PostgreSQL fixtures may migrate/test this schema.
- The policy is install provenance, not customer entitlement. Agent independently verifies a valid account-product JWS (ACCOUNT/EITHER) or a signed commercial key lease (LICENSE_KEY/EITHER) every time; DS policy must never substitute for either.

## Certification plan — behavioral ownership
- Primary DS owner: signing + SQL mode policy + machine proof identity + atomic audit/persistence.
- Required: `pr core licensing identity entitlements catalog prisma-isolation` (scope-specific signing vectors + disposable PostgreSQL migration/rollback/signer registry, SQL lock, no account substitution, exact issuer output).
- Cross-repo Agent proof reused: [#132 exact-head](https://github.com/jan2xo/bke-licensing-agent/actions/runs/43255996852); direct DS-to-Agent signed-vector verification is a separate explicitly required acceptance gate before product activation. No Agent main change in this DS source wave.
- Not required: `payments commerce notifications backups legal echo host platform agent-store standalone native-account` unless the current graph discovers a shared boundary. No payment/release or external HTTP surface changes.
- CI is intentional `/certify ...`, no heavy PR-triggered work, SHA-locked merge only after exact-head required graph PASS.

**PRODUCTION LOCKED.**
