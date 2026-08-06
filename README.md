# BKE Digital Solutions

## Compliance readiness

The administrator compliance register is available at `/admin/compliance`. It tracks implementation evidence separately from owner decisions and professional lawyer, DPO/privacy, accountant/BIR, and regulatory review. It must not be treated as legal or tax approval; see `docs/phase-reports/phase-6.7-legal-tax-compliance-review.md`.

Supply-chain evidence is visible at `/admin/supply-chain`. Generate CycloneDX SBOM and build provenance with `npm run supplychain:sbom` and `npm run supplychain:provenance`; signing certificates and malware clearance remain pending until independently provisioned.

Pre-VPS provider certification uses [Docker + Caddy](docs/local-production-simulation.md), a [temporary Cloudflare tunnel](docs/cloudflare-tunnel-paymongo.md), and the [owner evidence checklist](docs/local-provider-certification-checklist.md). Genuine PayMongo/Resend status is tracked in the [Phase 5.2 report](docs/phase-reports/phase-5.2-local-paymongo-resend-certification.md).

Secure commerce and licensing baseline for software, SaaS, and organizational deployments. Built with Next.js, TypeScript, Tailwind CSS, PostgreSQL, Prisma, PayMongo, Resend, and S3-compatible private storage.

The pushed baseline includes Phase 6.0 runtime parity, Phase 6.1 Data Integrity and Safe Deletion, Phase 6.1A Legal Document Management, the approved partially certified Phase 6.2 payment lifecycle, and Phase 6.3 Scheduler & Lifecycle Automation. The uncommitted Phase 6.4 working tree adds migration 21 and encrypted backup/disaster-recovery controls. Genuine PayMongo paid, refund, provider-retrieval, persisted-reconciliation, duplicate-paid-redelivery, and duplicate-refund-redelivery paths pass; genuine failed-payment, delayed, out-of-order, and raw-fixture evidence remain open. Live payments remain disabled, and the platform is not production-ready.

Phase 6.3 centralizes lifecycle work behind eight typed jobs, durable PostgreSQL run history, Valkey locks, an internal Docker scheduler worker, `/admin/scheduler`, and `/api/health/scheduler`. Run `npm run scheduler:run -- --dry-run` for an operations dry run; renewals always require a customer-authorized checkout.

Phase 6.4 adds a dedicated backup worker, encrypted PostgreSQL/private-object archives, manifests and checksums, retention, restore simulation, and isolated restore controls at `/admin/backups`. See [Backup Strategy](docs/backup-strategy.md) and [Restore Procedure](docs/restore-procedure.md). Do not enable real backups until dedicated offsite storage credentials and a separately escrowed encryption key are configured.

Phase 6.1 operating references: [data retention](docs/data-retention.md), [customer closure](docs/customer-account-closure.md), [privacy deletion](docs/privacy-deletion-workflow.md), [legal holds](docs/legal-hold.md), [storage cleanup jobs](docs/storage-cleanup-jobs.md), [product deletion](docs/product-deletion-workflow.md), and the [account role matrix](docs/authorization/customer-account-role-matrix.md).

## Local setup

Requirements: Node.js 22.12+, npm, Docker with Compose, and OpenSSL.

```bash
cp .env.example .env
openssl rand -base64 48   # generate SESSION_SECRET, LICENSE_PEPPER, and CRON_SECRET separately
docker compose up -d
npm install
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

The mock payment provider is the safe local default. Development email transport logs only a non-sensitive subject; it never prints recipients, authentication tokens, license keys, or message bodies. Resend is the production transactional email provider and `jl-bke.com` is its verified sending domain; API credentials and delivery certification remain environment-specific.

The certification suites explicitly load ignored `.env.certification`. `npm run certification:test:all` and `npm run certification:test:e2e` use deterministic mock/log providers against the certification services; genuine provider checks remain `npm run certification:test:paymongo` and `npm run certification:test:resend`. See the [runtime-parity contract](docs/runtime-parity.md), [certification runtime](docs/certification-runtime.md), and [local operations runbook](docs/operations-runbook.md).

Create the first administrator interactively with `npm run admin:create`. Do not place `ADMIN_PASSWORD` in committed files or shell history. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` before deployment.

## Production checklist

1. Provision PostgreSQL, Upstash-compatible Redis, and a private S3-compatible bucket. Production intentionally refuses an in-memory rate limiter.
2. Generate independent high-entropy secrets and inject them through the hosting platform's secret manager. Never expose server variables with a `NEXT_PUBLIC_` prefix.
3. Set `APP_URL` to the canonical HTTPS origin and configure Resend with a verified sending domain.
4. Activate PayMongo, set `PAYMENT_PROVIDER=paymongo`, add test keys first, and register exactly one webhook for supported payment events at `/api/webhooks/payments`.
5. Confirm the webhook signing secret and `PAYMONGO_LIVEMODE` agree with the account. Test wrong signatures, duplicate delivery, wrong amounts, and delayed events before live payments.
6. Apply committed migrations using `npm run db:deploy`, seed the catalog, bootstrap the administrator, and configure the renewal cron to POST with `Authorization: Bearer $CRON_SECRET`.
7. Configure encrypted backups, restore drills, dependency updates, log retention, alerting for failed webhooks, and secret/key rotation.

PayMongo redirects never confirm orders. Only a verified webhook with matching provider mode, amount, currency, and internal reference can finalize an invoice and issue an entitlement.

## Security operations

- Rotate `SESSION_SECRET` by forcing all sessions to expire. Rotating `LICENSE_PEPPER` requires a planned license-key rotation because existing hashes depend on it.
- Treat database, email, payment, object-storage, and Redis credentials as separate secrets with minimum permissions.
- Investigate repeated authentication failures, failed webhook verification, cross-account denials, activation-limit events, and administrative license changes.
- If compromise is suspected, disable checkout, revoke provider keys and active sessions, preserve audit evidence, rotate affected credentials, reconcile payments directly with PayMongo, and notify affected customers as required.
- Commercial invoices generated by this application are not represented as BIR-certified tax invoices.

See the [infrastructure baseline](docs/infrastructure-baseline.md), [brand system](docs/brand-system.md), [admin product management](docs/admin-product-management.md), [customer purchase flow](docs/customer-purchase-flow.md), [two-day MVP report](docs/two-day-mvp-report.md), [architecture](docs/architecture.md), [authorization matrix](docs/authorization.md), [payment flow](docs/payment-flow.md), [threat model](docs/threat-model.md), [PayMongo sandbox verification](docs/paymongo-sandbox.md), [Phase 5 enterprise security roadmap](docs/phase-5-enterprise-security.md), [administrator MFA runbook](docs/admin-mfa-runbook.md), and the [production deployment checklist](docs/deployment-checklist.md).

For a controlled VPS test deployment using either Git pull or direct SSH copy, follow the [VPS staging deployment runbook](docs/vps-staging-deployment.md).

Platform administration documentation: [roadmap](ROADMAP.md), [Phase 4 overview](docs/phase-4-platform-administration.md), [implementation status](docs/implementation-status.md), [engineering handoff](docs/handoff.md), [developer journal](docs/developer-journal.md), [detailed Phase 4 report](docs/phase-reports/phase-4-platform-administration.md), [Phase 4.1 product lifecycle report](docs/phase-reports/phase-4.1-product-lifecycle-completion.md), [Phase 4.2 editions and plans report](docs/phase-reports/phase-4.2-product-editions-and-multi-plan-commerce.md), and [Phase 4.2 maintainability audit](docs/phase-reports/phase-4.2-maintainability-audit.md).

Browser checkout sends only identifiers and acknowledgements; all prices, discount amounts, limits, intervals, and renewal terms are loaded and calculated by the server.

Registration and checkout submit the identifiers of the exact published legal versions shown to the customer. The server rejects missing, stale, or plan-inappropriate versions and writes immutable acceptance evidence in the same transaction as registration or order creation. Administrators manage Markdown templates, publication history, rollback, reacceptance, and acceptance counts at `/admin/legal`; public current and historical versions live under `/legal/:slug`. Seeded text is placeholder content and must receive professional legal, privacy, and tax review before launch. See the [Legal Center](docs/legal-center.md), [versioning rules](docs/legal-versioning.md), and [acceptance-history model](docs/legal-acceptance-history.md).

Pending orders can resume their stored provider checkout or create one recorded replacement session for older orders, and customers can cancel while the order is still pending. A verified provider payment received after local cancellation still completes the paid order; redirects and local cancellation never override provider-confirmed funds.

Verified customer accounts may start one seven-day trial per product per UTC calendar year, selecting an authorized individual or organization account and a product edition. Selecting another edition does not reset eligibility. Trials use the selected edition's normal license, activation, expiration, and private-download protections. Administrators manage additional grants, 0–14 day grace periods, and revocation at `/admin/trials`.

Archived products expose a typed-name permanent-delete action only to administrators. The server refuses deletion when any customer cart, commerce, invoice, payment, subscription, license, activation, assignment, download, or license-event history exists. There is no force-delete endpoint or UI.
## Operations visibility

Administrators can use `/admin/observability` to answer “Is the BKE platform healthy?” across application dependencies, scheduler, backups, payments, licensing issuance, email, security, and infrastructure. The typed health feed is available at `/api/health/metrics`. See [docs/observability.md](docs/observability.md).
