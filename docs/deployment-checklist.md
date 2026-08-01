# Production deployment checklist

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
- [ ] Run `npm run test:paymongo` and retain evidence that real checkout creation, paid, failed, refunded, duplicate, delayed, and reconciliation checks executed rather than skipped.
- [ ] Test stale signature, wrong mode, wrong amount/currency, malformed payload, replay, delayed delivery, and provider outage scenarios.
- [ ] Reconcile daily provider settlements against local payments, orders, invoices, refunds, and failed webhook records.
- [ ] Switch to live keys and `PAYMONGO_LIVEMODE=true` only after sandbox evidence is approved.

## Resend

- [ ] Verify the sending domain and configure SPF, DKIM, and DMARC.
- [ ] Set a production `EMAIL_FROM` and scoped `RESEND_API_KEY` in the secret manager.
- [ ] Test verification, magic-link, password reset, receipt, invitation, and renewal delivery plus bounce/complaint handling.
- [ ] Set `RESEND_SANDBOX_TO`, run `npm run test:resend`, and retain evidence that the gated test executed rather than skipped.
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

- [ ] Configure the canonical HTTPS `APP_URL`, DNS, trusted proxy headers, and automatic certificate renewal.
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
- [ ] Complete TOTP enrollment and store recovery codes offline before enabling administrator traffic.
- [ ] Confirm Valkey is available for distributed login, MFA, and recent-auth throttling.
- [ ] Exercise password → TOTP, one recovery code, expiry, replay rejection, idle expiry, and recent-auth denial in staging.
- [ ] Record the manual account-takeover recovery approvers and identity-verification process.
