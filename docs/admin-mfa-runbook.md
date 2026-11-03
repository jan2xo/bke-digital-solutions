# Google-only administrator MFA runbook

## Bootstrap

1. Create the intended BKE user through Google registration and complete BKE contact-email verification.
2. Apply the application migrations with `npm run db:deploy`.
3. Run `npm run admin:create` with `ADMIN_USER_ID` set to that existing user ID. The script requires a Google subject binding, an active account, BKE-verified contact email, exact typed ID confirmation, an authorization reason, and an operator identity.
4. In staging or production, set `ADMIN_BOOTSTRAP_ACK=I_UNDERSTAND_THIS_CREATES_A_PRIVILEGED_ACCOUNT`. When another administrator already exists, set `ADMIN_ALLOW_ADDITIONAL=true` only after explicit authorization.
5. The script promotes the existing account, records an audit event, and revokes its existing sessions. It does not set contact verification, create a user, change credentials, reset MFA, or establish a privileged session.
6. Sign in with the already-bound Google account. Complete the fresh BKE email-factor step-up, enroll application MFA, and store recovery codes offline before using protected administrator functions.

## Normal use

Ordinary Google sign-in creates a basic session. Administrators must have enabled and verified application MFA before protected administrator operations. Sensitive actions require a recent BKE factor. Google sign-in alone does not satisfy that requirement.

The application MFA code is sent to the already verified BKE contact email and is distinct from Google authentication. If several verification emails arrive, use the newest reference. Recovery codes are displayed once and consumed once.

## Emergency recovery

If an active Google-bound administrator loses every application MFA factor, use the procedure in [Emergency administrator recovery](security/emergency-admin-recovery.md). Recovery requires the owner recovery secret, exact user-ID confirmation, a reason, and an operator identity. It revokes sessions and outstanding challenges and creates a short-lived one-time enrollment authorization. Never add a password bypass or edit MFA rows manually.
