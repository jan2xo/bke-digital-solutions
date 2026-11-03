# Administrator application MFA

Digital Solutions administrators sign in with Google OIDC. A Google session is BASIC until the separate BKE application factor is verified. An enabled administrator MFA account must complete the BKE email code or a single-use recovery code before protected administrator access. Google email profile claims do not set BKE contact verification.

The Google subject is bound to one BKE principal. Administrator bootstrap promotes only an existing active Google-bound principal whose BKE contact email has already been verified. The operator command records the reason and operator, revokes existing sessions, and does not set up credentials or enable MFA. See the [administrator runbook](../admin-mfa-runbook.md).

Login, enrollment, and recent-authentication challenges remain purpose-bound. Codes are derived and stored as keyed hashes, are single-use, and have expiry and bounded attempts. Resending replaces the pending challenge. Recovery codes are generated cryptographically, shown once, stored as keyed hashes, and atomically consumed.

A fresh BKE factor grants recent authentication. It does not enroll or enable MFA by itself. Unenrolled administrators may use the verified BKE contact email factor to begin or resume enrollment. Every protected administrator operation still requires MFA enabled and verified.

If email delivery fails, authentication remains blocked. Use a saved recovery code when the account is enrolled, or follow the [emergency recovery runbook](emergency-admin-recovery.md). Do not treat Google sign-in, Google email verification, an old ID-token timestamp, or an email-only bypass as application MFA.
