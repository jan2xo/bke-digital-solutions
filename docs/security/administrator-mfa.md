# Administrator MFA

Every administrator must use password authentication followed by TOTP. Password success for an enrolled administrator creates only a five-minute, HttpOnly, same-site challenge reference; it does not create an application session. A valid TOTP or unused recovery code atomically consumes the challenge and creates an MFA-verified session.

An administrator without MFA receives a restricted enrollment session after password verification. It cannot satisfy `requireAdmin` and can access only the enrollment flow. Enrollment is valid for ten minutes and requires that password verification still be recent. The QR image is rendered locally; no secret is sent to a third-party QR service.

TOTP uses six digits, SHA-1, 30-second periods, and accepts the current period plus one adjacent period in either direction. Secrets use versioned AES-256-GCM authenticated encryption. `MFA_ENCRYPTION_KEY` is mandatory in staging and production. Recovery codes are generated with cryptographic randomness, shown once, stored only as keyed hashes, and consumed transactionally.

Administrator magic links are deliberately rejected. MFA disablement immediately revokes sessions and returns the administrator to mandatory enrollment. Recovery-code regeneration replaces every prior unused code and revokes other sessions.

Operational setup and emergency recovery are documented in [emergency-admin-recovery.md](./emergency-admin-recovery.md).
