# Platform email

This seam owns delivery, deadlines and durable outbox dispatch through small injected provider/store contracts. Domain owners decide why a message exists and render its business content. The platform does not import application routes, Prisma, global credentials, domain packages or templates.

Cloudflare accepts an injected send operation from the Worker wrapper, whose native API is checked against Wrangler-generated types. The wrapper keeps that operation in the existing request scope. Resend resolves configuration lazily through its injected resolver. Both providers return void only after a valid acceptance ID; that does not prove inbox delivery.

EmailDeliveryError separates acceptance certainty from retry and fallback policy. Unknown acceptance always stops retries/fallback, including when a caller requests contradictory flags. Only explicit Cloudflare quota/rate rejections are fallback-eligible. Pre-call configuration failures can prove rejection; they never silently switch the primary.

The dispatcher uses bounded batches/attempts, per-row five-minute claims and compare-and-swap ownership. It records only safe category codes. Post-acceptance persistence failures and unknown exceptions are held as DELIVERY_UNCONFIRMED. The host SQL adapter holds every expired processing claim for review, because a crashed sender may already have delivered. The existing terminal status stores that operational hold without a schema change; it is not a declaration of failed delivery.

Receipts report selected/recovered/reviewRequired/sent/failed/terminal/skipped counters. A provider's idempotency window is not assumed permanent. Legacy application delivery uses the same canonical dispatcher; queue-only imports do not load transport configuration. Log-only Staging still has no sending authority.

Real provider acceptance, domain/plan setup and deployed delivery are separate from protocol, type and disposable PostgreSQL tests. See [business email operations](../../docs/email-resend.md).
