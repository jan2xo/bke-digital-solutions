# recent authentication

Digital Solutions now uses Google OAuth/OIDC only. The previous BKE password, magic-link, email-OTP, application MFA and recovery-code instructions are retired.

Use the current [Google-only consumer runbook](../operations/GOOGLE-OAUTH-CONSUMER.md) for session policy, operator assignment, recovery boundaries and source versus live acceptance. The owner retired the additional 15-minute Google authentication-time check for **administrator** actions because it blocked normal administration despite completed Google sign-in. Admin endpoints require an active, non-suspended, Google-subject-bound BKE session using `GOOGLE_OIDC` and explicit `ADMIN` role, plus their pre-existing per-operation CSRF/origin, confirmation, validation, rate-limit, and audit controls. This removes a defense-in-depth step against stolen active admin sessions; it is **not** equivalent security to step-up authentication.

Customer-sensitive `requireRecentUser` and Agent-native authorization freshness remain unchanged. Administrators visiting `/security/recent` are redirected rather than receiving an unnecessary step-up prompt; the customer recency flow stays available.
