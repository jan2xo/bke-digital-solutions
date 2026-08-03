# Production deployment checklist

## Phase 6.1 data integrity

- [ ] Back up PostgreSQL and review/apply `20260803180000_data_integrity_safe_deletion`; treat it as forward-only.
- [ ] Confirm customer DELETE returns `HARD_DELETE_DISABLED`; exercise close, reopen, privacy review, legal hold, pseudonymization, and blocker report with a non-production account.
- [ ] Obtain professional legal/privacy/tax/accounting approval for actual retention periods before enabling final purge.
- [ ] Confirm legal acceptances, orders, invoices, payments, refunds, licenses, webhook evidence, audit events, and relevant email evidence survive closure/pseudonymization.
- [ ] Configure Phase 6.3 to process due cleanup jobs; until then, operate manual admin processing and alert on `FAILED` rows.
- [ ] Verify no product is finalized while cleanup is pending/failed and no new dependency appeared between request and finalization.
- [ ] Confirm S3 deletion is idempotent and the runtime identity has delete access only to the private application bucket/prefix.
- [ ] Test MEMBER, BILLING, LICENSE_MANAGER, and OWNER access with cross-account denial.

## Phase 6.1A legal system

- [ ] Back up PostgreSQL, then apply `20260802170000_legal_document_management` and `20260802171000_legal_document_type_uniqueness` with `npm run db:deploy`.
- [ ] Run the idempotent seed or create and publish all nine document types through `/admin/legal`.
- [ ] Replace every seeded placeholder with professionally approved wording; record legal and privacy approval outside the application.
- [ ] Set and verify `APP_URL`, `SUPPORT_EMAIL`, and `BUSINESS_ADDRESS`; confirm variable rendering contains no placeholder address.
- [ ] Verify Terms/Privacy registration acceptance, perpetual EULA/Refund acceptance, subscription EULA/Refund/Subscription acceptance, and renewal acceptance.
- [ ] Publish a staging revision with reacceptance enabled and prove login redirects without session revocation.
- [ ] Confirm administrator publication is denied without MFA and recent authentication.
- [ ] Confirm published-version mutation/deletion and acceptance update/deletion fail at the database layer.
- [ ] Include legal acceptance tables and trigger functions in backup/restore validation and retention planning.

Precondition: complete the local provider checklist and Phase 5.2 evidence report. Cloudflare remains authoritative DNS, all Resend records must be preserved, and VPS deployment is intentionally postponed.

Do not mark a deployment ready until every applicable box has an owner, evidence, and completion date.

## PostgreSQL

- [ ] Review and deploy `20260730174924_product_editions_multi_plan`, `20260731103000_pending_order_resume`, and `20260731113000_product_trials` in order; compare legacy order/invoice/payment amounts before and after and confirm every active annual plan has an active monthly source.
- [ ] Back up before migration. Treat the migrations as forward-only once editions, checkout URLs, or trial history exist; do not drop them as a production rollback.

- [ ] Use a supported managed PostgreSQL release in a private network with TLS required.
- [ ] Create separate least-privilege runtime and migration users; deny public ingress.
- [ ] Run `npm run db:generate`, review migration SQL, back up, then run `npm run db:deploy` once per release.
- [ ] Enable point-in-time recovery, encrypted automated backups, retention policy, and quarterly restore drills.
- [ ] Monitor connections, storage, replication lag, long queries, failed transactions, and migration status.

## Redis or Valkey

- [ ] Set `REDIS_URL` to a TLS-protected private endpoint or configure the Upstash REST variables.
- [ ] Require authentication, encryption, memory limits, eviction policy, and network restrictions.
- [ ] Confirm multiple app instances share rate-limit state and alert on connection failures or saturation.
- [ ] Use a dedicated database/namespace and never run test `FLUSHDB` operations in production.

## PayMongo

- [ ] Activate and verify the merchant account; begin with test keys and `PAYMONGO_LIVEMODE=false`.
- [ ] Compare the adapter against PayMongo's current checkout and signature documentation.
- [ ] Set only `sk_test_…`, the sandbox webhook secret, `PAYMONGO_LIVEMODE=false`, and `PAYMENT_PROVIDER=paymongo`; prove the safety gate rejects live credentials.
- [ ] Register one HTTPS webhook at `/api/webhooks/payments`; store its signing secret only in the secret manager.
- [ ] Run `npm run certification:test:paymongo`; checkout creation passed locally, but retain genuine paid/failed/refunded/duplicate/delayed/reconciliation evidence before launch.
- [ ] Test stale signature, wrong mode, wrong amount/currency, malformed payload, replay, delayed delivery, and provider outage scenarios.
- [ ] Reconcile daily provider settlements against local payments, orders, invoices, refunds, and failed webhook records.
- [ ] Switch to live keys and `PAYMONGO_LIVEMODE=true` only after sandbox evidence is approved.

## Resend

- [x] Verify the `jl-bke.com` sending domain with Resend.
- [ ] Confirm Cloudflare DNS retains the required Resend records and configure/review DMARC policy.
- [ ] Set a production `EMAIL_FROM` and scoped `RESEND_API_KEY` in the secret manager.
- [ ] Test verification, magic-link, password reset, receipt, invitation, and renewal delivery plus bounce/complaint handling.
- [x] Set the owner-controlled recipient and run `npm run certification:test:resend`; genuine API, registration, and outbox delivery were accepted in Phase 5.2.
- [ ] Ensure emails never contain passwords, provider secrets, or reusable download grants.

## S3-compatible private storage

- [ ] Create a private bucket with public access blocked, encryption enabled, versioning, and retention rules.
- [ ] Grant the application read access only to the required object prefix; separate upload/admin credentials.
- [ ] Verify artifact SHA-256, size, content type, and malware/signing pipeline before catalog activation.
- [ ] Confirm downloads are streamed only after entitlement checks and one-time grants reject reuse and forgery.
- [ ] Monitor download errors, unusual grant creation, object deletion, and access-policy changes.
- [ ] Confirm redemption re-checks license status/expiration and consumes grants rejected after revocation or expiration.
- [ ] Alert on `PRODUCT_DELETE_STORAGE_CLEANUP_FAILED`; verify S3 delete permission and retry the archived product deletion after restoring storage health. Never log the affected object key.

## Domain and HTTPS

- [x] Acquire `jl-bke.com` and make Cloudflare authoritative DNS; Namecheap remains the registrar only.
- [ ] Configure the canonical HTTPS `APP_URL`, Cloudflare proxy records, trusted proxy headers, and automatic certificate renewal after VPS provisioning.
- [ ] Redirect HTTP to HTTPS and verify HSTS, CSP, frame denial, MIME, referrer, and permissions headers.
- [ ] Confirm production cookies use `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`, and the `__Host-` prefix.
- [ ] Restrict allowed origins and run an external TLS and security-header scan.

## Backups and disaster recovery

- [ ] Encrypt database and object-storage backups with keys separated from application credentials.
- [ ] Document RPO/RTO, restore order, reconciliation procedure, and responsible responders.
- [ ] Perform and record end-to-end restoration into an isolated environment at least quarterly.
- [ ] Preserve append-only audit and payment evidence according to legal retention requirements.

## Monitoring and incident response

- [ ] Add structured redacted logs, request IDs, error tracking, uptime checks, and paging ownership.
- [ ] Alert on failed/retried webhooks, checkout failure spikes, license issuance mismatch, admin changes, authentication abuse, rate-limit service failure, and expiring subscriptions.
- [ ] Monitor PostgreSQL, Redis/Valkey, PayMongo, Resend, S3, cron jobs, and Next.js health independently.
- [ ] Maintain runbooks for payment reconciliation, credential exposure, unauthorized access, email abuse, storage compromise, and rollback.
- [ ] Complete privacy, Philippine data-protection, license-terms, refund-policy, and tax/invoice review.

## Secret rotation and release gate

- [ ] Store all production secrets in the deployment platform's secret manager; no `.env` files on shared hosts.
- [ ] Assign rotation intervals and owners for database, Redis, PayMongo, Resend, S3, cron, session, and license keys.
- [ ] Rotate `SESSION_SECRET` with planned session revocation; rotate `LICENSE_PEPPER` only with a license-key migration plan.
- [ ] Run migrations, seed safely, bootstrap administrators through controlled access, and remove temporary credentials.
- [ ] Require clean lint, typecheck, unit, database integration, Playwright, production build, and dependency audit results.
- [ ] Require a PayMongo sandbox checkout/webhook/reconciliation pass and an independent security review before launch.

## Platform administration

- [ ] Obtain documented legal, tax, accounting, and privacy approval before enabling permanent customer deletion in production; it intentionally destroys orders, payments, invoices, entitlements, and personal data.
- [ ] Restrict permanent customer deletion to named administrators, enforce recent login and distributed rate limiting, monitor `CUSTOMER_PERMANENTLY_DELETED`, and test backup/restore implications.
- [ ] Decide whether backups must retain deleted customer data and document how retention, erasure requests, and restoration interact. Restoring an old backup can reintroduce erased personal data.
- [ ] Review every published edition's capabilities, user/device limits, update policy, and enabled plans; confirm annual discounts are 0–10% and totals match the server calculation.
- [ ] Review the seven-day trial policy, confirm the UTC calendar-year reset is acceptable, and restrict administrator trial grants and 0–14 day grace changes to authorized support staff.
- [ ] Monitor trial grant, grace-change, revoke, expiration, activation, and download audit events; test expiration processing before launch.
- [ ] Alert on repeated pending-checkout replacement attempts and reconcile provider captures received after local order cancellation.

- [ ] Require MFA and recent authentication for administrator key disclosure and destructive entitlement changes.
- [ ] Restrict administrator accounts to named staff; review access and audit exports monthly.
- [ ] Configure artifact malware scanning, code signing, checksum verification, orphan-object cleanup, and retention.
- [ ] Alert on customer suspension, device resets, license transfer/reveal/revoke, release rollback, artifact replacement/removal, and invoice resend spikes.
- [ ] Alert on blocked and successful permanent-product-deletion audit actions; periodically verify that only archived products with zero preserved dependencies can be deleted.
- [ ] Validate audit export retention, access controls, CSV handling, and scale limits.
# Flexible offers deployment addition

- [ ] Back up PostgreSQL and verify restore before deploying the additive offer migration.
- [ ] Run `npm run db:deploy` before starting application instances that query offer fields.
- [ ] Verify migration `20260731025700_flexible_discount_offers` and its check constraints are present.
- [ ] Smoke-test normal, discounted, and explicitly authorized zero-total checkout using test accounts.
- [ ] Verify duplicate/delayed webhook application issues one entitlement and one redemption application.
- [ ] Monitor `RESERVED` offer usage; do not manually release a reservation unless provider reconciliation proves it cannot settle.
- [ ] Verify customer-specific codes cannot be used or enumerated by another billing account.
# Phase 5.1 administrator security

- [ ] Generate and store an independent 48+ character `MFA_ENCRYPTION_KEY`.
- [ ] Apply `20260802090000_enterprise_admin_mfa` before the application rollout.
- [ ] Back up the MFA key separately and restrict read access to deployment operators.
- [ ] Bootstrap administrators only with the documented protected-environment acknowledgement.
- [ ] Complete administrator email-code enrollment and store recovery codes offline before enabling administrator traffic.
- [ ] Confirm Valkey is available for distributed login, MFA, and recent-auth throttling.
- [ ] Exercise password → email code, resend invalidation, one recovery code, expiry, replay rejection, idle expiry, and recent-auth denial in staging.
- [ ] Record the manual account-takeover recovery approvers and identity-verification process.
# Provider credential activation

- [ ] Generate and externally store `PROVIDER_CREDENTIALS_ENCRYPTION_KEY`; set its key version.
- [ ] Rotate PayMongo TEST and Resend credentials before saving them to PostgreSQL.
- [ ] Save, validate, and enable each provider through `/admin/providers`.
- [ ] Set `PROVIDER_CONFIG_SOURCE=database` with fallback false and restart.
- [ ] Repeat PayMongo sandbox webhook and Resend delivery certification; scan logs for secrets.
- [ ] Remove and revoke superseded environment credentials only after database-source certification passes.
# Phase 6.0 runtime-parity gate

- [x] Production and certification application/migration images use the same digest-pinned build targets.
- [x] Migration-first startup, idempotent seed, database smoke, readiness, and force-recreate refresh are verified locally.
- [x] Prisma client regeneration is reproducible and all 18 migrations are current in the Phase 6.1 review tree.
- [x] Full deterministic Vitest and Playwright suites pass against certification PostgreSQL, Valkey, and MinIO.
- [x] Local and Docker production builds, Compose validation, secret hygiene, and runtime dependency audit pass.
- [ ] Rotate any certification credentials that have appeared in owner chat or retained diagnostic output.
- [ ] Complete genuine PayMongo lifecycle certification in Phase 6.2; live payments stay disabled.
- [ ] Complete backup/restore, monitoring, operations hardening, professional compliance review, and production-readiness review before deployment.
