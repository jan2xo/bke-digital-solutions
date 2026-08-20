# Universal updater integration status

Implemented on feat/universal-updater-integration:

- Machine endpoint: POST /api/agent/updates/check
- Existing license entitlement and account lifecycle are required.
- Existing customer release resolver is used; only active published STABLE/LTS releases are eligible.
- Existing ProductArtifact metadata supplies artifact identity, SHA-256, size, and content type.
- Existing DownloadGrant is created with a 60-second one-time token.
- Policy is bke.update-policy.v1 and is signed with the active commercial Ed25519 key.
- No private key or object-store credential is returned.

The ProductVersion model now persists minimumSupportedVersion through migration 20260820120000_minimum_supported_version. The API uses that value and falls back to the target version only when the field is unset. Optional/offline deadline behavior still requires local certification fixtures.
