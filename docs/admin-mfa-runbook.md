# Administrator MFA Runbook

1. Configure a unique `MFA_ENCRYPTION_KEY` of at least 48 random characters.
2. Apply migrations with `npm run db:deploy` before starting the new application version.
3. Run `npm run admin:create`. In staging/production set `ADMIN_BOOTSTRAP_ACK=I_UNDERSTAND_THIS_CREATES_A_PRIVILEGED_ACCOUNT`. Updating the same account requires `ADMIN_UPDATE_EXISTING=true`; resetting its MFA additionally requires `ADMIN_RESET_MFA=true`. A distinct second administrator requires `ADMIN_ALLOW_ADDITIONAL=true` after authorization.
4. Sign in with the administrator email and password. The application redirects to mandatory enrollment.
5. Scan the QR code, verify one current six-digit code, then store the displayed recovery codes offline. Codes are not shown again.
6. Normal future sign-in requires password then TOTP/recovery code. Administrator magic links do not sign in.

If the authenticator is lost, use one recovery code. If all factors are lost, an authorized operator must verify identity out of band, use the bootstrap procedure to reset that specific administrator, and require fresh enrollment. Never add an email-only bypass or edit MFA rows manually. Preserve `SecurityEvent` records for investigation.

Before key rotation, deploy code capable of decrypting the old key version and encrypting the new version, re-encrypt every method in a controlled job, verify counts/decryption, then retire the old key. The current release has no automatic rotation job.
