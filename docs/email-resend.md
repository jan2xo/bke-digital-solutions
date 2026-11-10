# Business email: Cloudflare primary, Resend fallback

Google is the only customer/admin sign-in provider. Email is not used for login, contact verification, password reset, magic links, OTP or application MFA. This document covers business delivery only.

Cloudflare Email Sending is the Workers primary. The injected binding belongs to the current operation; no binding or in-flight request is cached globally. Resend is invoked automatically only after Cloudflare explicitly rejects with E_RATE_LIMIT_EXCEEDED or E_DAILY_LIMIT_EXCEEDED. Recipient allowlists/suppression, account restrictions, sender errors, internal errors and uncertain outcomes never trigger fallback. Resend fallback must use the same server-owned sender address.

Worker production rejects direct Resend mode: Cloudflare is mandatory as its primary. The explicit Node/Docker cold target retains operator-selected Resend delivery; this is a deployment fallback, not an automatic bypass of an uncertain Cloudflare send.

The supported EMAIL_PROVIDER values are:
- log: development and the existing isolated log-only Staging operation.
- cloudflare: Workers primary, with its provisioned binding and valid EMAIL_FROM.
- resend: explicitly selected operator fallback/Node-Docker target and isolated provider certification.

Resend configuration remains in the existing encrypted provider store or its approved environment fallback. No Cloudflare sending API token is needed for the Worker binding. The Node/Docker target has no native binding; select its explicit Resend fallback rather than pretending the binding exists.

## Durable delivery and uncertainty

The existing durable outbox dispatches INVOICE_ISSUED, SECURITY_SESSIONS_REVOKED, SECURITY_NEW_SESSION and SECURITY_ACCOUNT_CHANGED. A new PURCHASE_CONFIRMED message is explicitly opt-in through PURCHASE_CONFIRMATION_EMAIL_ENABLED=true (generation-independent, default OFF), gating both enqueue and dispatch. A signed provider-verified paid webhook queues the order's deduplicated invoice message inside the settlement transaction, then schedules an exact-order outbox dispatch after the webhook ACK. This targeted path never drains unrelated older emails; protected cron retries definite failures and recovers interrupted/missed queueing. Legacy PAYMENT_RECEIPT and other commerce/lifecycle emails remain retired; authenticated in-app account Notifications remain canonical. The purchase email is plain text, with authenticated invoice/BKE links, canonical billing account recipient, and no raw license key or Claim Code. Do not activate live delivery without separate authorization and Cloudflare sender/domain/binding readiness. No new queue, service or database is introduced.

A provider message ID acknowledges acceptance; it does not prove inbox delivery. The stored SENT state means BKE recorded that acknowledgement. Both send paths have bounded waiting, at most15seconds per attempt. A timeout, malformed result, unknown response, Resend409/idempotency conflict or other uncertain acceptance stops automatic work. Raw provider messages, credentials, recipients and tokens are not written to failure codes.

If a process disappears after claiming, BKE cannot know whether it sent before crashing. Every expired PROCESSING claim therefore moves to the existing PERMANENTLY_FAILED state with lastError=DELIVERY_UNCONFIRMED. The same hold applies if a provider accepts but success acknowledgement persistence fails. This state prevents automatic re-selection; it does not assert that delivery definitely failed. The tradeoff is manual review even when a crash happened before sending.

Dispatch receipts include reviewRequired, including expired claims held for review. The invoice center displays an unconfirmed-delivery notice. Review provider delivery records, recipient and claim time before an explicit manual resend; do not reset/requeue unknown outcomes automatically. Existing role/audit controls still govern manual invoice email. Resend receives the stable outbox-row idempotency key, but its24-hour retention is not treated as permanent deduplication or proof of non-acceptance.

Definite retryable rejection retains the existing maximum five attempts and default20-message batch. Each claim gets its own five-minute TTL. Compare-and-swap ownership prevents concurrent workers from dispatching the same row. Queue-only legacy imports lazily delegate actual dispatch to this canonical implementation and do not initialize transport settings.

## Setup and acceptance

The source Wrangler email binding is for native interface generation/local simulation. The existing protected Staging preparation strips that binding and still requires log-only email; this source change does not enable sending or widen the protected operation.

Before separately approved activation, verify Email Sending entitlement, onboarded sender/domain, allowed_sender_addresses restrictions, effective plan limits and actual delivery. Workers Paid alone is not evidence of Email Sending readiness. Initial read-only inspection of the selected account returned Email Domain API403/code2079 (Domain API unavailable) and found no email binding on the deployed Worker. Reverify live state; no onboarding, DNS, credentials transfer or real mail was performed by source preparation.

The existing typecheck now first generates Wrangler CloudflareEnv types and checks the Worker bridge. Protocol tests use injected providers and timers; disposable PostgreSQL tests exercise crash/recovery, acknowledgement failure, concurrent claims and terminal uncertainty using actual outbox columns. These checks do not prove real provider delivery.

A genuine owner-authorized Resend fallback check uses npm run certification:test:resend with the ignored certification environment and a controlled RESEND_SANDBOX_TO recipient. General tests have no intentional external delivery. That explicit sandbox address is enforced; configuration errors do not silently choose another primary.

Customer/Agent notifications remain under the authenticated account-session endpoint and shared Notifications normalization; email does not become a second source of commerce or licensing truth.

References: [Cloudflare Worker API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Resend idempotency](https://resend.com/changelog/idempotency-keys).
