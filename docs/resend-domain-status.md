# Resend domain status

- Sending domain: `jl-bke.com` (owner reports verified in Resend).
- Phase sender: `BKE Digital Solutions <noreply@jl-bke.com>`.
- Production transport: Resend behind the email-provider abstraction.
- Sending identity does not imply that `noreply@`, `billing@`, `licenses@`, `security@`, or `support@` has an inbound mailbox.

Real delivery is opt-in. Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, and `RESEND_SANDBOX_TO` only in an ignored environment file, then run `npm run test:resend`. The suite skips when configuration is absent and fails when supplied credentials or sender configuration are invalid. A successful API delivery does not guarantee inbox placement.

Cloudflare is authoritative DNS. Preserve all Resend SPF/DKIM records during future DNS or VPS changes.

