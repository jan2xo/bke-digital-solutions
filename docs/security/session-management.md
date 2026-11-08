# session management

Digital Solutions now uses Google OAuth/OIDC only. The previous BKE password, magic-link, email-OTP, application MFA and recovery-code instructions are retired.

Use the current [Google-only consumer runbook](../operations/GOOGLE-OAUTH-CONSUMER.md) for session policy, signed Google authentication freshness, operator assignment, recovery boundaries and source versus live acceptance. Ordinary Google sign-in does not require BKE MFA. Sensitive actions remain guarded and cannot use a new OAuth callback as a substitute for recent Google authentication proof.
