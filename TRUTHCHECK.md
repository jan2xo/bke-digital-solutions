# BKE Digital Solutions — Current-State Truth Check

Cross-repository planning baseline: [docs/roadmaps/master-completion-roadmap.md](docs/roadmaps/master-completion-roadmap.md).

Baseline updated: August 13, 2026

Phase 2 release/latest resolution correction is implemented. Phase 3 is **PASS (certified 2026-08-13)** for live signing, independent verification, mutation invalidation, re-signing, idempotency, authorization, and private-key non-exposure. Phase 4's malware/artifact pipeline is implemented and certified in the repository/certification environment; production Compose now declares a private health-gated ClamAV service, while VPS provisioning and certification remain incomplete.

Phase 6.7 technical compliance tracking is present at `/admin/compliance`. It records implemented controls and explicitly pending owner, lawyer, accountant/BIR, DPO/privacy, and regulatory review. It is not evidence of professional approval.

Phase 6.8 supply-chain evidence is present at `/admin/supply-chain`; CycloneDX SBOM and provenance tooling are available. No production signing certificate or malware certification is claimed.

Phase 6.9 release lifecycle and approval tracking are present in the Release Center. Stable/LTS promotions require approval records; production readiness remains blocked by pending signing, malware, recovery, compliance, and deployment gates.
Pushed Git baseline: current `main` commit; historical hashes below are retained for provenance.
Latest committed roadmap phases: Phase 6.0 — Runtime Parity, Phase 6.1 — Data Integrity and Safe Deletion, Phase 6.1A — Legal Document Management, the Phase 6.2 payment lifecycle implementation, and Phase 6.3 Scheduler & Lifecycle Automation

Current truth: Phases 6.4 through 6.12 repository controls are implemented. Certification backup CREATE, VERIFY, SIMULATE_RESTORE, and RESTORE_ISOLATED passed. The project owner confirmed on 2026-08-13 that the production VPS exists and PayMongo is live and operational there. Repository-retained evidence still does not certify the complete Phase 6.10 infrastructure sequence, production RPO/RTO, cold reboot, deployed commit, or every live-provider lifecycle scenario.

Phase 6.1A, legal-consent hardening, and administrator password-plus-email-code verification are committed and pushed. The seeded legal text remains explicitly placeholder content and does not satisfy professional legal, privacy, tax, or BIR review.

Phase 6.1 is committed at `952e9e1`. Phase 6.2 is partially certified: genuine paid settlement, retrieval, reconciliation, full refund, signed refund, and duplicate paid/refund redelivery pass. Genuine failed, delayed, out-of-order, and raw-fixture evidence remains open with deterministic coverage. Phase 6.3 is committed at `099fe7c`. Certification backup recovery is complete through isolated restore; production RPO/RTO, legal review, monitoring, secure supply chain, and production deployment remain blocked or externally deferred.

This document is the concise repository baseline for future planning. It records verified implementation and runtime evidence rather than roadmap intent. If this file conflicts with an older phase report, the current repository, applied migrations, executable tests, and runtime evidence take precedence.

## Executive verdict

BKE Digital Solutions is a functional software-commerce and licensing MVP. It includes a public catalog, customer portal, MFA-protected administrator portal, PayMongo hosted checkout integration, invoices, application-managed subscriptions, encrypted licenses, device activation, private installer downloads, trials, discounts, audit history, security events, and external-provider credential management.

PayMongo LIVE operation is owner-verified. Deployment, licensing-agent, artifact, and production certification remain separate gates; unavailable sandbox evidence does not downgrade live readiness.

## Repository truth

- Branch: `main`.
- Pushed HEAD: `66f9fdd fix(database): serialize Prisma queries in interactive transactions`.
- `main` matches `origin/main` at the Phase 6.3 follow-up baseline before Phase 6.4 working-tree changes.
- Twenty migrations are pushed. Uncommitted migration 21 is applied to development; certification verification remains pending.
- Prisma schema validation and generated-client parity passed.
- TypeScript, ESLint, database-backed Vitest, Playwright, local/Docker production builds, and the runtime dependency audit passed for the latest verified baseline.
- The certification application and dependencies are current and healthy.

## Verified automated results

| Verification | Result |
|---|---|
| TypeScript | Passed for the Phase 6.4 working tree |
| ESLint | Passed for the Phase 6.4 working tree |
| Vitest | 155 passed locally, 6 credential-gated scenarios skipped |
| Playwright | 11/11 passed locally |
| Production and Docker builds | Passed |
| Migration status | 21 migrations in the working tree; development current, certification Phase 6.4 verification pending |
| Genuine PayMongo checkout creation | Passed |
| PayMongo live-key sandbox rejection | Passed |
| Genuine Resend delivery | Passed |
| Genuine persisted PayMongo retrieval | Passed |
| Genuine signed paid/refund webhook processing | Passed at runtime; exact raw fixture intentionally not retained |
| Genuine refund lifecycle | Passed |
| Genuine duplicate paid/refund provider resend | Passed without duplicate effects |
| Genuine delayed/out-of-order provider resend | Owner-interactive and not yet certified |
| Genuine persisted reconciliation | Passed |
| Phase 6.4 encrypted certification archive | CREATE/VERIFY passed; zero missing source objects |
| Phase 6.4 complete recovery | SIMULATE_RESTORE and RESTORE_ISOLATED passed; production RPO/RTO remains pending |

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

Customer account detail now gates order, subscription, trial, and license visibility by the capability matrix. Plain `MEMBER` users receive limited account metadata and do not see the Order history or Subscriptions panels. Remaining authorization work is tracked in the Laguna findings and requires acceptance-level API coverage for every organization boundary route.

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
- Real signed `payment.paid` and `checkout_session.payment.paid` events settled PayMongo orders through the canonical endpoint.
- Real provider payment retrieval and persisted reconciliation passed with no differences.
- PayMongo accepted a real Test Mode full refund and delivered a signed `payment.refunded` event.
- The refund transaction changed order/payment to `REFUNDED`, invoice to `VOID`, revoked licenses, cancelled subscription access, and queued the deduplicated refund confirmation.
- Stored failed PayMongo events caused by reference mismatches are not valid genuine failed-checkout evidence.
- Caddy access logs previously exposed the PayMongo signature header. Both Caddy configurations now delete it, and a runtime probe confirmed it is absent.

### Verdict

PayMongo LIVE is **implemented / live / owner-verified**. Failed, delayed, and out-of-order provider scenarios remain separate evidence items and are not a Selling MVP blocker.

## Email truth

- Immediate provider email exists for verification, magic link, and password reset.
- Database outbox messages exist for payment receipt, invoice issuance, license issuance, payment failure, refund confirmation, new admin session, revoked sessions, and provider credential changes.
- The full license key is not sent by email.
- Outbox retries are bounded to five attempts.
- A genuine Resend delivery from the verified `jl-bke.com` domain passed.
- The certification database reported 23 sent outbox records.

### Phase 6.3 notification work verified

- Renewal reminders are queued at plan-specific 14/7/1-day windows with durable deduplication.
- Trial-ending, trial-expiration, license-expiration, and subscription-expiration notifications are queued through the outbox.
- A dedicated Docker scheduler worker invokes the centralized scheduler every minute. The certification worker and database-backed health endpoint report all eight jobs healthy; this does not replace production deployment or future monitoring.

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
- Certification uses a self-contained mock provider and does not certify PayMongo LIVE. LIVE readiness is owner-verified separately.
- No VPS deployment exists.
- Public Cloudflare-to-local access is not equivalent to production deployment.
- Health and environment validation exist.
- The committed Phase 6.3 Docker worker and centralized cron endpoint passed local-production simulation and certification-runtime verification. Actual production deployment and monitoring remain later phases.
- Phase 6.4 backup jobs, encryption, manifests, verification, retention, and isolated restore controls exist in the uncommitted working tree. A real offsite archive and production-sized restore drill are not yet verified.
- No verified centralized monitoring or alerting exists.
- No malware scanning, code-signing operation, or independent production security review is complete.

## Launch blockers

### Critical

1. Incomplete provider-interactive PayMongo failed-payment and resend evidence.
2. Phase 6.4 requires complete local/certification verification and owner review.
3. No production offsite backup or production-sized restore drill has passed.
4. No operational monitoring and alerting.
5. No approved administrator recovery and incident-response process.
6. No completed legal, privacy, refund, support, and tax/BIR approval.

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
| Local public certification | Partially certified; provider-interactive cases remain |
| VPS staging | Not ready until baseline and operating controls are completed |
| Private sandbox pilot | Conditionally usable for invited testers |
| Real customer use | Not ready |
| Live payments | Not ready |
| Production desktop distribution | Not ready |
| Production launch | Not ready |

## Authoritative next work

The approved implementation sequence is defined in [`ROADMAP.md`](./ROADMAP.md), beginning with:

1. Completed: Phase 6.0 — Runtime Parity & Certification Baseline.
2. Completed: Phase 6.1A — Legal Document Management System.
3. Completed and pushed: Phase 6.1 — Data Integrity & Safe Deletion.
4. Partially certified: Phase 6.2 — paid, refund, retrieval, reconciliation, and duplicate paid/refund redelivery pass; failed/delayed/out-of-order evidence remains.
5. Implemented and uncommitted pending full verification: Phase 6.4 — Backup & Disaster Recovery. Do not begin Phase 6.5 before owner approval.

No future phase should claim readiness merely because code exists. Database state, runtime configuration, automated tests, genuine provider evidence, documentation, and owner approval must agree.

Production Compose restart policies are verified statically. No Docker daemon boot or VPS reboot has been observed; VPS deployment remains uncertified until the owner records cold-reboot evidence.
## Phase 6.5 working-tree truth

Licensing boundary correction: the activation response contains no runtime authorization decision. BKE Digital Solutions issues commercial entitlement material; the separate Agent verifies, binds, and produces `AuthorizationDecision`.

Monitoring and observability code exists in the current uncommitted working tree. Migration 22 is applied and current in development and certification. It adds `ObservabilityAlert`, `/admin/observability`, and `/api/health/metrics`. TypeScript, ESLint, Prisma validation/generation, Vitest (155 passed, 6 credential-gated skipped), Playwright (11/11), production build, Docker builds, runtime health checks, and repository hygiene passed. The metrics endpoint correctly reports CRITICAL while the incomplete Phase 6.4 recovery point remains. Phase 6.4 recovery certification remains pending and Phase 6.6 has not started.
## Current production-readiness matrix (RM5)

| Area | Status | Evidence/limitation |
|---|---|---|
| RM1 Licensing | VERIFIED | Agent wire-format, cryptographic, persistence, binding, and authorization checks passed; live runtime handoff remains environment-gated. |
| RM2 Supply Chain | COMPLETE | Evidence-backed signature/malware gates implemented; production scanner and certificates remain external. |
| RM3 Governance | COMPLETE | Server-side approval separation, forward-only transitions, audit, and break-glass controls implemented. |
| RM4 Reliability | PARTIAL | Download recovery and OTP redaction verified; worker Docker heartbeat certification remains pending. |
| Tests | PENDING | TypeScript/ESLint passed; full Vitest/Playwright not completed in latest verification. |
| Builds | PENDING | Production/Docker build verification not completed in latest verification. |
| Docker | PENDING | Compose/runtime verification requires available Docker daemon. |
| Documentation | COMPLETE | Current matrix and dispositions synchronized here. |
| VPS | DEFERRED | Phase 6.10. |
| Cloudflare | DEFERRED | Phase 6.10. |
| HTTPS | DEFERRED | Phase 6.10 production validation. |
| PayMongo Live | BLOCKED | Live payments intentionally disabled. |
| Resend Production | PENDING | Requires genuine production delivery evidence. |
| Malware Scanner | PENDING | Production scanner adapter/configuration not provisioned. |
| Signing Certificates | PENDING | Platform signing certificates not provisioned. |
| Restore Certification | PENDING | Complete production recovery drill not certified. |
| Legal Review | PENDING PROFESSIONAL REVIEW | No legal approval fabricated. |
| Privacy Review | PENDING PROFESSIONAL REVIEW | DPO/privacy review pending. |
| Accountant/BIR Review | PENDING PROFESSIONAL REVIEW | Tax review pending. |

## SOL dispositions

- Licensing boundary: RESOLVED locally; external runtime handoff certification remains pending.
- Supply-chain self-attestation: RESOLVED.
- Release governance/separation of duties: RESOLVED.
- Download-grant recovery: RESOLVED.
- OTP log redaction: RESOLVED.
- Scheduler/backup Docker heartbeat: ACCEPTED TECHNICAL DEBT.
- Production malware scanner: ACCEPTED TECHNICAL DEBT.
- Signing certificates: ACCEPTED TECHNICAL DEBT.
- Restore certification: ACCEPTED TECHNICAL DEBT.
- Licensing Agent documentation synchronization: ACCEPTED TECHNICAL DEBT.
- VPS, Cloudflare, and public HTTPS: DEFERRED — PHASE 6.10.
- Legal, privacy, and tax approvals: PENDING PROFESSIONAL REVIEW.

## Version 7 — Post-production enhancement

Planned after production readiness: Compliance Review Center, Legal Workflow,
Reviewer Assignment, Approval Timeline, Version Comparison, and Compliance
Notifications. This is a post-production enhancement, not a Phase 6 blocker.
## RM7 current truth

RM7 corrections are committed in `7d7b733`. Repository verification is current
for static checks; PostgreSQL, Docker, browser-port, and provider checks remain
environment or external certifications. RM7 lifecycle and key-rotation work is
implemented with evidence requirements enforced server-side.
RM8C rotation controls are implemented in repository code; production key
provisioning and PostgreSQL concurrency certification remain pending.

RM7F refresh reuse and terminal revocation evidence are implemented. Renewal
successor issuance and atomic transfer finalization remain repository blockers.

RM7G transfer finalization now follows prepare/issue/finalize. Bound-renewal
successor issuance is wired through the confirmed-payment workflow; no-binding
renewal remains explicit and terminal. Runtime retry certification remains
pending.

RM7H implementation adds source-predecessor transfer lifecycle, material refresh
comparison, bounded prepared-renewal recovery, immutable rotation replay checks,
and atomic rotation audit evidence. Runtime retry certification remains pending
where full database/browser evidence is unavailable.
