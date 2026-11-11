# DS L3 account-product lease: pre-signing claims authority (source only)

**Source ownership:** DS #340. **Status:** IMPLEMENTATION PENDING. **NO signing endpoint, no live signing keys, no package publication and no production.

**Stacked base:** DS #343 `bea3e223b50dcbfaae294631178cb0f948893e66` (exact-head certified 7/7); #343 is based on DS #341 (6/6 L2 source proof), both draft/unmerged. Shared @bke/licensing account-product JWS contract PR #90 `03dfbbae3a5e4acc95b82e323940555d85cdcf42` and Agent .NET verifier PR #120 `5895f574b77e8c263cd452e6a713045b15e0ecad` are draft/unreleased. DS production package pins @bke/licensing 0.9.0, which lacks the new product JWS issuer.

**Intent:** prepare exactly one strict v1 product execution lease claims object from a previously authorized server-owned L2 decision and a separately proven trusted Agent key/session registration. Hard expiry is capped by both 5-minute policy and every underlying right/key expiry; renewal hint is never the authorization deadline. Derive SHA-256 SPKI thumbprint, require fresh proof, match account/user/session/registered key and never assert TPM attestation without real hardware proof. No JWS is issued in this wave.

**Minimum complete certification graph:** DS `pr + core + licensing + entitlements + catalog + native-account` at exact head, intentionally triggered by trusted `/certify` comment; no payments/commerce, upstream library, Agent/Launcher binaries, installer/UTM, production, publication or signer key custody workflows because their behavior is unchanged.

**Outstanding security gates:** actual DS machine-key enrollment with proof-of-possession and trusted registration, signer key custody/rotation, lease issuance/denial audit within transactional lifecycle, immutable @bke/licensing contract release+repin, authenticated route + rate limiting, Agent/product end-to-end signed verification and clock rollback protections. Do not mistake an input record marking a proof as verified for a secure live machine-registration system.

**Production:** LOCKED.
