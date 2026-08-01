# Email and Resend operations

Resend is the production transport and `jl-bke.com` is verified according to the infrastructure baseline. Use the provider abstraction and commerce outbox; do not send directly from routes that settle payment. The certification sender is `noreply@jl-bke.com`; inbound mail service is separate.

Run genuine owner-authorized delivery only with ignored credentials:

```bash
npm run test:resend
```

The check skips when required variables are absent. With variables present, API/auth/sender errors fail the check. Never enable real mail in the general automated test environment. Token values, full license keys, and full message bodies must not be logged.

