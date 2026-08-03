# Administrator MFA Runbook

1. Configure a unique `MFA_ENCRYPTION_KEY` of at least 48 random characters.
2. Apply migrations with `npm run db:deploy` before starting the new application version.
3. Run `npm run admin:create`. In staging/production set `ADMIN_BOOTSTRAP_ACK=I_UNDERSTAND_THIS_CREATES_A_PRIVILEGED_ACCOUNT`. Updating the same account requires `ADMIN_UPDATE_EXISTING=true`; resetting its MFA additionally requires `ADMIN_RESET_MFA=true`. A distinct second administrator requires `ADMIN_ALLOW_ADDITIONAL=true` after authorization.
4. Sign in with the administrator email and password. The application redirects to mandatory enrollment.
5. Request the email verification code, confirm that the reference in the newest email matches the verification page, enter its six-digit code, then store the displayed recovery codes offline. Recovery codes are not shown again.
6. Normal future sign-in requires password then a code delivered to the verified administrator email, or a recovery code. Administrator magic links do not sign in.

If multiple verification emails arrive, use only the newest message and confirm its short reference matches the verification page. Requesting another code immediately invalidates the previous challenge. If email delivery is unavailable, use one recovery code. If all factors are lost, an authorized operator must verify identity out of band, use the bootstrap procedure to reset that specific administrator, and require fresh enrollment. Never add a passwordless administrator bypass or edit MFA rows manually. Preserve `SecurityEvent` records for investigation.

Before key rotation, deploy code capable of decrypting the old key version and encrypting the new version, re-encrypt every method in a controlled job, verify counts/decryption, then retire the old key. The current release has no automatic rotation job.
