# BKE Digital Solutions — Current-State Truth Check

Audit date: August 2, 2026  
Audited Git commit: `d004ada6fc9fb09ad7e516b7d91f7c126dcb8a5a`  
Latest completed implementation phase: Phase 5.3 — Security Dashboard and Session Administration

Current working-tree candidate: Phase 6.1A adds the legal document/version/acceptance platform, secure rendering, administrator lifecycle UI, registration and checkout consent, and reacceptance. It is uncommitted and awaiting owner review. The seeded text is explicitly placeholder content and does not satisfy professional legal, privacy, tax, or BIR review.

Working-tree verification on August 2, 2026: Prisma schema validation and migration status passed with 15 migrations applied; TypeScript and ESLint passed; Vitest passed 110 tests with six genuine-provider scenarios skipped; Playwright passed 9/9; and the production build passed. These results verify the local Phase 6.1A candidate only and do not change the PayMongo, legal-review, backup, monitoring, secure-supply-chain, or production-deployment launch blockers below.

This document is the concise repository baseline for future planning. It records verified implementation and runtime evidence rather than roadmap intent. If this file conflicts with an older phase report, the current repository, applied migrations, executable tests, and runtime evidence take precedence.

## Executive verdict

BKE Digital Solutions is a functional software-commerce and licensing MVP. It includes a public catalog, customer portal, MFA-protected administrator portal, PayMongo hosted checkout integration, invoices, application-managed subscriptions, encrypted licenses, device activation, private installer downloads, trials, discounts, audit history, security events, and external-provider credential management.

It is ready for local development and controlled sandbox certification. It is not ready for unrestricted public payments, real-customer production use, or production installer distribution.

## Repository truth

- Branch: `main`.
- Audited HEAD: `d004ada feat(security): add security dashboard and session administration`.
- At audit completion, `main` matched `origin/main` and the working tree was clean.
- Thirteen Prisma migrations exist in the repository.
- The ordinary development PostgreSQL database had all thirteen migrations.
- TypeScript, ESLint, database-backed Vitest, Playwright, and a production build passed during the audit.
- The certification PostgreSQL database had only twelve migrations and lacked `20260802143000_security_dashboard_sessions`.
- The running certification application image predated the audited Phase 5.3 commit.

## Verified automated results

| Verification | Result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Vitest | 99 passed, 6 provider-gated scenarios skipped |
| Playwright | 8 passed |
| Production build | Passed |
| Development migration status | 13 migrations, current |
| Certification migration status | 12 migrations, one behind |
| Genuine PayMongo checkout creation | Passed |
| PayMongo live-key sandbox rejection | Passed |
| Genuine Resend delivery | Passed |
| Genuine persisted PayMongo retrieval | Skipped/not certified |
| Genuine captured webhook verification | Skipped/not certified |
| Genuine refund lifecycle | Not certified |
| Genuine delayed/duplicate lifecycle | Not fully certified |
| Genuine persisted reconciliation | Skipped/not certified |

The first sandbox-restricted Vitest execution could not reach local PostgreSQL. The identical suite was rerun with database access and passed. That initial failure was an execution-sandbox restriction, not an application result.

## What the application can do

### Public and customer services

- Display active products, editions, and perpetual/monthly/annual purchase plans.
- Register a unique-email customer with an individual customer account.
- Send email verification, magic-link, and password-reset messages.
- Authenticate customers by password or one-time magic link.
- Let verified customers purchase through server-authoritative checkout.
- Continue or cancel pending orders.
- Display order, invoice, subscription, license, device, trial, and download information.
- Reveal encrypted license keys to authorized account roles.
- Activate and deactivate devices while enforcing limits.
- Issue one-time, short-lived private installer download grants.
- Start one seven-day trial per customer account, product, and UTC calendar year.
- Renew subscriptions through a new customer-authorized checkout.

### Administrator services

- Bootstrap an administrator outside public registration.
- Require password-plus-email-code verification for administrators and support single-use recovery codes.
- Require recent authentication for high-impact operations.
- Manage products, editions, purchase plans, releases, and artifacts.
- Manage customers, orders, invoices, licenses, devices, trials, and offers.
- Review business audits and export audit CSV.
- Review their own security timeline and active sessions.
- Revoke one, other, or all administrator sessions.
- Store masked, encrypted PayMongo and Resend credentials in PostgreSQL.
- Validate, enable, disable, rotate, and revoke stored provider credentials.

## Identity and account truth

- `User` represents a person and has a global `CUSTOMER` or `ADMIN` role.
- `CustomerAccount` owns commerce, subscriptions, licenses, trials, and downloads.
- A customer account may be `INDIVIDUAL` or `ORGANIZATION`.
- `OrganizationProfile` is optional metadata attached to an organization account; there is no separate `Organization` model.
- `Membership` connects users to accounts with `OWNER`, `BILLING`, `LICENSE_MANAGER`, or `MEMBER` roles.
- Direct `ownerId` ownership is treated as `OWNER` authority.
- Registration creates a user and one individual customer account. It does not create an organization.
- Organization, invitation, and membership models exist, but customer-facing creation and administration workflows do not.
- Administrators cannot be created through public registration, and customer magic links do not authenticate administrators.
- No administrator impersonation capability exists.

### Known authorization concern

A plain `MEMBER` can currently open the account detail and see broad order, invoice, license, subscription, trial, and download information. More sensitive mutations use stronger owner/billing/license-manager checks, but visibility does not yet match a formally approved role matrix.

## Authentication and security truth

- Passwords use Argon2id.
- Password policy starts at 12 characters.
- Password reset tokens and verification/magic tokens are hashed, expiring, and one-time.
- Session tokens are random and stored only as hashes.
- Production cookies use the `__Host-` prefix, HTTP-only, Secure, SameSite `Lax`, and path `/`.
- Sessions have a 14-day absolute lifetime and a 60-minute idle timeout.
- Password change/reset, MFA changes, and explicit session administration revoke sessions as applicable.
- Administrator login requires a password plus a purpose-bound code sent to the verified administrator email, or an unused recovery code after enrollment.
- Recent authentication lasts 15 minutes for protected operations.
- Security events store hashed request hints and sanitized metadata.
- Security review signals are rule-based indicators, not a threat-detection or SIEM system.

### Known authentication gaps

- Customer license-key reveal is repeatable while ciphertext exists.
- Customer license reveal does not currently require recent authentication.
- Customer sessions have no self-service session inventory equivalent to the admin security page.
- Password reset records an administrator security event but does not send a dedicated password-changed notification.

## Commerce truth

- Current commerce uses `Product → Edition → PurchasePlan`.
- Legacy `Price` and `LicensePolicy` models remain for compatibility and historical relationships.
- Annual price derives from the monthly price with a server-enforced 0–10% annual discount.
- One promotion may apply after annual savings, producing separate immutable invoice lines.
- Server code reloads price, plan, currency, availability, account access, limits, and offer eligibility.
- Browser redirects never mark orders paid.
- Normal checkout creates an order, order-item snapshot, draft invoice, and payment attempt before calling the hosted provider.
- Pending payment sessions can be resumed or replaced if stale.
- A verified late paid webhook may settle a locally cancelled order.
- Explicitly authorized zero-total offers settle internally without PayMongo.
- Order and invoice snapshots survive later catalog changes.

### Known commerce gaps

- Abandoned promotion reservations have no completed expiry/release worker.
- Failed payment can leave an order pending for another attempt.
- Revenue displayed in admin is a gross paid-order placeholder, not accounting recognition.
- No automated provider refund-initiation interface exists.

## PayMongo truth

- PayMongo is behind the common payment-provider interface; the mock provider remains available for automated tests.
- Test/live key prefixes and local-simulation live-mode prohibition are enforced.
- Checkout creation uses hosted PayMongo checkout and idempotency keys.
- Webhooks verify the raw body, signature, timestamp, test/live branch, event identity, amount, currency, reference, and provider identifiers.
- Webhook processing records payload hashes rather than raw payloads.
- Paid settlement, invoice finalization, entitlement issuance, and offer application are transactional.
- Duplicate identical events are idempotent; conflicting reuse of an event ID is rejected.
- Refund handling revokes licenses and cancels related subscription access.
- Reconciliation compares provider/local payment ID, amount, currency, mode, and status but does not repair discrepancies.

### Genuine runtime evidence

- Real PayMongo sandbox hosted-checkout creation passed.
- Certification data contained seven processed paid webhook events, seven paid orders, seven PayMongo paid records, and seven active licenses.
- Certification data also contained nine failed `payment.paid` events and one failed `payment.failed` event. Every stored error was `PAYMENT_MISMATCH`.
- No genuine refund certification evidence was present in the audited aggregate.

### Verdict

PayMongo connectivity and some successful settlement are real. Full successful, failed, duplicate, delayed, out-of-order, refund, and reconciliation certification has not passed. PayMongo is not approved for live mode.

## Email truth

- Immediate provider email exists for verification, magic link, and password reset.
- Database outbox messages exist for payment receipt, invoice issuance, license issuance, payment failure, refund confirmation, new admin session, revoked sessions, and provider credential changes.
- The full license key is not sent by email.
- Outbox retries are bounded to five attempts.
- A genuine Resend delivery from the verified `jl-bke.com` domain passed.
- The certification database reported 23 sent outbox records.

### Missing or incomplete notifications

- Renewal cron selects due subscriptions but does not enqueue reminder emails.
- Trial start/end and expiration emails are absent.
- License/subscription expiration messages are absent.
- Continuous outbox execution requires an external scheduler that is not yet production-certified.

## Subscription, trial, and license truth

- Perpetual purchases issue non-recurring licenses.
- Monthly and annual plans create application-managed subscriptions.
- No automatic PayMongo recurring charging exists.
- Each renewal requires a new customer-authorized checkout.
- Renewal extends the existing subscription/license and prevents duplicate entitlement issuance.
- Promotional monthly cycles are finite and consumed across renewal checkouts.
- Trial eligibility is one account/product/UTC year; changing edition does not bypass it.
- Administrators can grant trials, add 0–14 days of grace, and revoke them.
- Licenses store a keyed hash, last four characters, and optionally encrypted recoverable ciphertext.
- Activation enforces status, expiry, seats, and device limits transactionally.
- License key plus device identifier is the current machine-authentication mechanism.

## Installer and storage truth

- Releases support semantic versions, stable/beta channel, latest, publication, deprecation, and rollback.
- Artifacts store operating system, architecture, checksum, size, content type, and a private object key.
- Installer upload validates extension and maximum size.
- Download grants are random, hashed, one-time, and valid for approximately 60 seconds.
- Grant redemption revalidates license status and expiry.
- Forged, expired, reused, or revoked-access grants fail.
- No permanent public object URL is exposed.

### Critical storage findings

- Product deletion deletes storage objects while its PostgreSQL transaction remains open. If one of several deletions succeeds and a later deletion fails, PostgreSQL can roll back while the first object remains deleted.
- Artifact replacement records old-object cleanup failure but has no automatic retry worker.
- Malware scanning does not exist.
- Installer code signing does not exist.

## Destructive customer deletion truth

The current admin deletion operation permanently deletes the customer and dependent commerce/licensing records, including orders, payments, invoices, subscriptions, licenses, trials, sessions, outbox messages, and relevant audits.

This conflicts with the platform principle that historical commerce must remain immutable and creates potential accounting, tax, dispute, fraud, privacy-retention, and security-evidence problems. It must be redesigned before production customer use.

## Provider credential truth

- PostgreSQL-backed encrypted PayMongo and Resend credential models and administrator controls are implemented.
- Credentials are masked, versioned, replaceable, revocable, and never displayed again.
- A master encryption key and previous-key map support decryption and rotation.
- Runtime selection is explicitly `environment` or `database`, with optional fallback.
- Local production simulation forbids PayMongo live mode.

During the audit, certification runtime used the default environment source:

- `PROVIDER_CONFIG_SOURCE` was unset and therefore defaulted to `environment`.
- PayMongo and Resend environment credentials were present.
- The database-provider master encryption key was absent.
- Real certification traffic therefore used environment credentials, not database credentials.

## Public API truth

- No versioned public API exists.
- No service-account model exists.
- No scoped or revocable public API-key model exists.
- No separate desktop license-validation or heartbeat endpoint exists.
- The device activation endpoint is machine-facing but uses the full license key as its bearer credential.
- External products such as AIRSTACK or RenderDock cannot yet authenticate with independent scoped credentials.
- No global server secret should ever be embedded into a distributed client.

## Support truth

The application has a configurable support email address, but no support platform. It has no support-ticket workflow, live chat, customer message history, administrator replies, attachment flow, SLA tracking, or notification center.

## Deployment and operations truth

- Local development uses Next.js, PostgreSQL, Valkey, and MinIO.
- Certification uses the production Docker image topology with Caddy, PostgreSQL, Valkey, and MinIO behind Cloudflare Tunnel.
- `jl-bke.com` can reach the local certification environment.
- Certification is configured as staging/local-production-simulation with PayMongo sandbox mode.
- No VPS deployment exists.
- Public Cloudflare-to-local access is not equivalent to production deployment.
- Health and environment validation exist.
- Cron endpoints exist but production scheduling is incomplete.
- No verified backup job or restore drill exists.
- No verified centralized monitoring or alerting exists.
- No malware scanning, code-signing operation, or independent production security review is complete.

## Launch blockers

### Critical

1. Certification migration and application-image drift.
2. Unexplained stored PayMongo `PAYMENT_MISMATCH` failures.
3. Incomplete genuine PayMongo lifecycle certification.
4. Destructive deletion of historical customer commerce.
5. Partial storage-deletion inconsistency risk.
6. Missing renewal-reminder and scheduler completion.
7. No verified backup and restore process.
8. No operational monitoring and alerting.
9. No approved administrator recovery and incident-response process.
10. No completed legal, privacy, refund, support, and tax/BIR foundation.

### Desktop-distribution blockers

1. No malware scanning.
2. No code signing/notarization.
3. No public scoped client API for products requiring ongoing validation.

### High priority

- Organization and membership management.
- Formal role/capability enforcement.
- Customer support workflow.
- Promotion-reservation recovery.
- Operational reconciliation and manual resolution.

## Honest readiness verdict

| Use | Verdict |
|---|---|
| Local development | Ready |
| Local public certification | Conditionally ready after migration/image repair |
| VPS staging | Not ready until baseline and operating controls are completed |
| Private sandbox pilot | Conditionally usable for invited testers |
| Real customer use | Not ready |
| Live payments | Not ready |
| Production desktop distribution | Not ready |
| Production launch | Not ready |

## Authoritative next work

The approved implementation sequence is defined in [`ROADMAP.md`](./ROADMAP.md), beginning with:

1. Phase 6.0 — Runtime Parity & Certification Baseline.
2. Phase 6.1 — Data Integrity & Safe Deletion.
3. Phase 6.1A — Legal Document Management System.

No future phase should claim readiness merely because code exists. Database state, runtime configuration, automated tests, genuine provider evidence, documentation, and owner approval must agree.
