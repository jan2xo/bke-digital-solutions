# Email and Resend certification

Resend is the configured production email transport. Email is intentionally reserved for communication that requires an email channel:

- account verification
- magic sign-in links
- password reset
- administrator MFA/login codes
- critical administrator security notices
- explicit administrator-requested invoice email

Normal commerce and product lifecycle events do **not** use Resend. Payment received, payment failed, refund confirmed, invoice ready, license ready, renewal approaching, subscription expiry, trial lifecycle, and license expiry are projected as authenticated BKE account notifications from canonical domain state.

The durable email outbox accepts only:

- `INVOICE_ISSUED`
- `SECURITY_SESSIONS_REVOKED`
- `SECURITY_NEW_SESSION`
- `SECURITY_ACCOUNT_CHANGED`

Older queued commerce/lifecycle email types are retired by the email lifecycle job with `EMAIL_CHANNEL_RETIRED` and are never selected by the dispatcher.

## Account notifications

The Licensing Agent reads customer notifications through the authenticated Agent account-session authority:

```text
GET /api/agent-sessions/notifications?product_id=<public-product-id>&limit=<1..200>
Authorization: Bearer <Agent-owned access token>
x-bke-account-session-version: bke.account-session.v1
```

The endpoint derives notifications from authoritative payment, invoice, license, subscription, and trial state. It does not create a second cloud notification database. Notification intent normalization remains owned by `@bke/notifications`.

## Resend certification

Run genuine owner-authorized delivery from the host, not the slim production image:

```bash
npm run certification:test:resend
```

This command explicitly loads ignored `.env.certification`; it does not fall back to `.env`. Missing requirements skip clearly, while invalid present credentials or sender configuration fail. The general test suite does not intentionally send external mail.

Registration, verification resend, magic link, password reset, and administrator MFA delivery send immediately. Manual invoice email and security notices use the durable outbox. A cron-authenticated processor handles retries:

```bash
npm run certification:outbox
```

Resend may resolve its API key and sender identity from the encrypted provider store. Status APIs expose only masked credential hints. Provider error bodies and credentials are never exposed to callers.
