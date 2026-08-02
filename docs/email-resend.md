# Email and Resend certification

Resend is the configured production transport and `jl-bke.com` is verified. Sending identity does not create an inbound mailbox.

Run genuine owner-authorized delivery from the host, not the slim production image:

```bash
npm run certification:test:resend
```

This command explicitly loads ignored `.env.certification`; it does not fall back to `.env`. Missing requirements skip clearly, while invalid present credentials or sender configuration fail. The general test suite does not intentionally send external mail.

Registration, verification resend, magic link, and password reset currently send immediately. Registration returns `emailSent:false` if provider delivery fails. Commerce settlement transactionally queues payment, invoice, license, failure, and refund messages in `EmailOutbox`, then attempts dispatch. A cron-authenticated processor handles retries:

```bash
npm run certification:outbox
```

For an owner-controlled outbox smoke message:

```bash
npm run certification:compose -- queue-email
npm run certification:outbox
```

Phase 5.2 genuine results: direct Resend delivery passed; public registration returned HTTP 201 with `emailSent:true`; password-reset delivery returned HTTP 200; one queued message became `SENT` with one attempt, and a second processor call did not resend it. Inbox placement is not guaranteed by API acceptance.
# Database credential source

Resend may resolve its API key and sender identity from the encrypted provider store. Save and validate the `@jl-bke.com` sender before enablement. Status APIs show only a masked hint. Genuine delivery certification remains separate from credential validation.
