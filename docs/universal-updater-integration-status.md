# Universal updater integration status

Implemented on feat/universal-updater-integration:

- Machine endpoint: POST /api/agent/updates/check
- Existing license entitlement and account lifecycle are required.
- Existing customer release resolver is used; only active published STABLE/LTS releases are eligible.
- Existing ProductArtifact metadata supplies artifact identity, SHA-256, size, and content type.
- Existing DownloadGrant is created with a 60-second one-time token.
- Policy is bke.update-policy.v1 and is signed with the active commercial Ed25519 key.
- No private key or object-store credential is returned.

Important certification limitation: the current schema has no independent minimum-supported-version field. This checkpoint therefore emits the eligible target version as minimum_supported_version, making the returned update mandatory. A future additive release-policy field must be introduced and migrated before optional-update/deadline semantics can be certified. No claim of optional offline behavior is made here.
