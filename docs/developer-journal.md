# Developer journal

## 2026-07-31 — Phase 4.2 blueprint and repository inspection

### Objective

Replace the single mutable catalog price assumption with reusable product editions and multiple purchase plans while keeping historical commerce immutable and leaving provider recurring charges uncertified/unimplemented.

### Repository state inspected

Read `CORE-INSTRUCTION.md`, the complete file inventory, Git status/log, roadmap, README, architecture/status/handoff/journal, Phase 4 and 4.1 reports, Prisma schema and migrations, seed, validation, product administration, storefront, checkout, provider webhook, licensing issuance, renewals, dashboards, invoices, deletion eligibility, and all unit/integration/browser tests. Phase 4/4.1 is committed at `e98e4b9`; unrelated brand, account-verification UX, and password-policy work remains intentionally uncommitted and must be preserved.

### Verified blueprint

1. Add `Edition` and `PurchasePlan`; keep legacy `Price`/`LicensePolicy` rows for history and compatibility rather than destructively renaming or repurposing them.
2. Edition owns feature JSON, user/device limits, and update policy. PurchasePlan owns type, currency, base amount for perpetual/monthly, annual discount, renewal behavior, active state, and the annual-to-monthly source relation.
3. Add nullable edition/plan links and immutable descriptive snapshots to new order items, subscriptions, and licenses. Existing historical rows remain financially unchanged.
4. Backfill one edition per current license policy and map legacy prices to plans. Existing annual-only prices receive an active monthly source and a calculated annual discount; historical order/invoice totals remain untouched.
5. Centralize integer-minor-unit annual calculation and plan normalization. Discount is 0–1000 basis points (0–10%); annual amount is rounded half-up and never accepted from browser/admin input.
6. Replace admin Price/Billing forms with edition/plan management, add public plan selection and authenticated checkout review, accept only `purchasePlanId` at the browser API boundary, and keep renewals customer-authorized.
7. Extend deletion eligibility and explicit child cleanup for editions/plans; any order/license/subscription still blocks product deletion.
8. Add migration, unit, PostgreSQL, and Playwright coverage, then run every required verification gate and update all required project records. No commit will be created.

### Initial commands

Used `sed`, `rg`, `rg --files`, `git status`, and `git log` to read the attached specification, core instructions, repository inventory, documentation, schema, services, routes, components, seed, and tests. Used a local Node calculation to assess exact legacy annual-price mapping.

### Decisions and risks

Annual pricing uses basis points to support exact and predictable minor-unit arithmetic. No automatic charging is introduced. Legacy tables remain until a later, separately reviewed historical-retention migration. Current annual catalog offerings may gain a monthly option during backfill because an Annual plan cannot exist without a monthly source under the target architecture.

### Next steps

Implement the additive schema/migration and pricing domain first, then extend flows and tests. Phase 5 remains prohibited.

## 2026-07-31 — Phase 4.2 implementation and verification

Implemented Edition-owned capabilities and PERPETUAL/MONTHLY/derived-ANNUAL PurchasePlans, additive migration/backfill, idempotent seed mappings, plan-ID-only checkout, immutable plan snapshots, plan-aware licensing/activation/renewal/customer views, admin edition/plan controls, storefront selection, and safe deletion of disposable edition/plan rows. Migration and seed ran against PostgreSQL. Final gates passed: TypeScript, ESLint, 36 Vitest tests with five credential-gated skips, 5/5 Playwright tests, and production build. Seed legacy-link idempotency, compressed catalog syntax, build worker environment, stale browser server, and ambiguous admin locators were found and corrected. PayMongo/Resend credentials remain absent, production readiness is not claimed, no commit was created, and Phase 5 was not started.

## 2026-07-31 — Phase 4.1 product lifecycle planning

### Objective

Add exceptional, audited permanent deletion for archived products that are demonstrably disposable, without changing the working Phase 4 systems.

### Repository state inspected

Reviewed the product, version, policy, price, artifact, cart, order-item snapshot, payment, invoice, subscription, license, activation, assignment, download-grant, license-event, and audit models plus the applied migration constraints. Reviewed the product administration route and UI, archive/restore behavior, storage and audit helpers, same-origin/auth conventions, administration tests, roadmap, Phase 4 report, implementation status, and handoff. Existing Phase 4 work remains uncommitted and must be preserved.

### Verified implementation plan

1. Add `evaluateProductDeletionEligibility(productId)` with structured existence, archived-state, dependency counts, removable-resource counts, and a stable reason code.
2. Treat order-item snapshots and their orders/invoices/payments/attempts, carts, subscriptions, licenses, assignments, activations, license events, artifact grants, and recorded downloads as blockers. Preserve audit logs because they use a scalar target identifier rather than a product foreign key.
3. Add an ADMIN-only, same-origin, validated deletion route with a read-only preview and typed-name confirmation. Return 404 for missing products, structured 409 conflicts for lifecycle/history blocks, and 204 only after complete cleanup.
4. Hold the database transaction while eligibility is re-evaluated and exclusive private objects are deleted. Object deletion is idempotent; on storage failure the database transaction rolls back and the product remains archived. A partially completed object cleanup is safe to retry because eligible products have no customer/history dependencies. No private object key is written to an audit record or error.
5. Delete artifact rows before versions, prices before policies, and finally the product to respect verified restrictive relations without changing global cascade behavior. Image keys and tag arrays require no child-table migration.
6. Add typed confirmation and dependency feedback to archived product cards, focused service/route/browser coverage, then run the complete regression/security gate and synchronize Phase 4.1 documentation.

### Commands executed

Inspected the attached specification with `sed`; searched documentation, routes, components, tests, schema relations, and lifecycle actions with `rg`; read `ROADMAP.md`, Phase 4/status/handoff documents, Prisma schema sections, storage, database, and audit helpers with `sed`.

### Files modified

`ROADMAP.md`, `docs/developer-journal.md`, and `docs/phase-reports/phase-4.1-product-lifecycle-completion.md`.

### Decisions

No migration is planned. Cart items are treated as customer-owned blockers. Order-item product/price/policy identifiers are snapshot scalars rather than product relations and therefore require explicit queries. Audit history is preserved. Storage cleanup must finish before a 204 response; failures are redacted and retryable.

### Failures and corrections

The first lookup expected `lib/api-error.ts`; the repository uses a different error-helper path. No application code was changed as a result.

### Next steps

Implement the evaluator, guarded route, UI, audits, and tests, then run and record every required verification command.

## 2026-07-31 — Phase 4.1 implementation and verification

### Objective and work performed

Implemented the reusable dependency evaluator and serializable deletion service, ADMIN/origin/Zod-protected preview and DELETE route, durable success/blocked/cleanup-failure audits, archived-only typed confirmation UI, PostgreSQL integration coverage, and Playwright lifecycle/security coverage. Synchronized all required Phase 4.1 documentation; no migration was created.

### Commands and results

Used `sed`, `rg`, `find`, and `git status` for inspection; `apply_patch` for changes; TypeScript and ESLint passed; focused PostgreSQL tests passed 5/5; full Vitest passed 26 with five credential-gated skips; focused Playwright passed 2/2; full Playwright passed 5/5; production build passed; Prisma found four applied migrations and an up-to-date schema; runtime critical audit found zero vulnerabilities; diff, secret, and sensitive-log scans passed. Exact invocations and retry history are recorded in the Phase 4.1 report.

### Files modified

Added the deletion service, route, dialog, focused integration test, and Phase 4.1 report. Modified the product manager, administration Playwright suite, roadmap, README, architecture, status, handoff, deployment/readiness, Phase 4 overview/report, and this journal.

### Decisions

Customer carts are blockers. Immutable order-item scalar IDs require explicit history lookup. Audit history remains. Cleanup is archived-only, locked, serializable, redacted, idempotently retryable, and has no force path. Database child deletion is explicit and ordered. No schema change was justified.

### Failures and corrections

Default-shell npm was unavailable; used the bundled runtime. Initial database access was sandbox-denied and passed with approval. Two browser approval attempts timed out; direct Playwright reuse of the already-running server worked. The new non-admin browser assertion raced login completion (401); waiting for the dashboard made the intended 403 assertion deterministic. Final full gates passed.

### Next steps

Review and commit the cohesive Phase 4 and Phase 4.1 working tree without test artifacts or unrelated files. Do not begin Phase 5. Production readiness remains blocked by external provider certification and infrastructure/operational controls.

### Pre-commit review correction

The final combined Vitest rerun launched the two PostgreSQL integration files concurrently. A serializable webhook transaction hit a write-conflict/deadlock, which caused its six dependent lifecycle assertions to fail even though both integration files passed independently and the earlier combined run passed. Database-backed files share mutable development infrastructure, so `vitest.config.ts` now disables cross-file parallelism while retaining sequential test execution inside each file. This is test isolation only; application transaction semantics were not weakened. The complete gate was rerun after the correction.

## 2026-07-31 — Platform administration layer

### Objective

Replace routine direct-database administration with secure platform tools while preserving the verified commerce baseline.

### Work performed

Extended product, release, artifact, customer, license, device, order, invoice, audit, and dashboard capabilities; created the administration navigation and tables; added the Phase 4 migration, RBAC/audit tests, documentation, and handoff material.

### Important decisions

Reused existing models and APIs; used soft archive/removal states; kept refunds provider/webhook-driven; made customer suspension revoke sessions; initially made license reveal one-time; kept artifact objects private.

### Files modified

Prisma schema/migration, auth/activation/download services, existing admin product/version/license APIs and pages, admin/customer Playwright suites, README, architecture, readiness and deployment documents.

### Problems and solutions

Existing minimal admin pages lacked domain metadata and operational actions. Additive fields and append-only migrations preserved compatibility. Large client tables were kept server-rendered with small mutation controls. One generated route syntax error was resolved by rewriting it in structured form.

### Next session

Complete real PayMongo/Resend certification when credentials are supplied, then plan MFA/recent-auth for privileged disclosure. The final local gate passed: 21 Vitest tests, four Playwright tests, typecheck, lint, build, migration status, and runtime critical audit.

## 2026-07-31 — Product-specific annual trials and pending checkout recovery

Added one seven-day self-service trial per account and product per UTC calendar year, administrator-created additional trials, editable 0–14 day grace periods, revocation, audit logs, and normal license/download/device enforcement. Customer trial status appears immediately above order history, including the existing Continue secure payment and Cancel order controls. Pending checkouts retain or safely recreate their provider checkout URL.

Owner direction subsequently changed license-key disclosure from one-time to repeatable. The customer and administrator endpoints now retain encrypted key material, re-check authorization and same-origin policy on every request, and append a non-sensitive license event for every reveal. Existing keys whose ciphertext had already been erased remain unrecoverable. One-time private download grants and one-time authentication tokens were not changed.

### Complete Phase 4.2 diff review

Reviewed the committed Phase 4.1 baseline against the complete modified/untracked tree, all three Phase 4.2-era migrations, schema, seed, commerce, pending-payment, trial, deletion, security, tests, generated Prisma output, and documentation. Unrelated brand/homepage and authentication UX work remains visibly separable in the working tree and was not reverted. No staged changes or tracked secrets/test artifacts exist.

Corrections made during review: repeatable reveal copy/API/tests/docs; exact trial description and authorized-account selector; cross-edition and concurrent annual-limit tests; atomic entitlement recheck/consumption for revoked or expired download grants; explicit late-payment-after-cancellation behavior; replacement-attempt mock checkout IDs; immutable snapshot and inactive-plan tests; and generic admin-bootstrap logging. The first focused Playwright command found a stale port listener. Its retry exposed the mock replacement-ID defect and failed 1/2; after correction, focused Playwright passed 2/2 and full Playwright passed 5/5.

Final authoritative results: local services healthy; Prisma valid/current/no drift with seven migrations; seed passed; focused Vitest 12/12; full Vitest 45 passed with five external credential-blocked skips; TypeScript, ESLint, production build, runtime critical audit, diff check, secret scan, and sensitive-log scan passed. No commit was created and Phase 5 was not started.

## 2026-07-31 — Secure permanent customer deletion

Implemented the owner-requested administrator action that permanently removes a non-admin customer even when commerce and licensing records exist. The UI requires the exact customer email and `DELETE ALL CUSTOMER DATA`; the API additionally requires same-origin, a login no older than 15 minutes, ADMIN role, and a five-per-hour distributed rate limit. Deletion locks the customer and runs the dependency-ordered erasure in one serializable transaction. Administrator and self-deletion are refused. The remaining audit tombstone contains only identifiers and aggregate counts, not email or raw customer/payment data.

Focused verification found and corrected one test-only invoice status (`ISSUED` to the schema's `FINAL`). The first sandboxed database attempt was denied local-network access; the approved run then exposed that fixture issue. A failed cleanup command used unsupported top-level await, and a second imported the server-only database wrapper; the direct Prisma cleanup succeeded. The corrected PostgreSQL integration suite passed 3/3. Production enablement remains blocked on legal, accounting, tax, privacy, and backup-retention approval because this action intentionally destroys financial history.

Migration `20260731113000_product_trials` was applied locally and the idempotent seed passed. TypeScript and ESLint passed; Vitest passed 40 tests with five external-credential-gated skips; Playwright passed 5/5; and the production build passed. The first Playwright run correctly received a CSRF 403 from an API-client replay lacking `Origin`; the test was corrected to perform the replay in authenticated browser context and then verified the annual duplicate response. A migrated seed edition with historical trials was deactivated rather than deleted, preserving all history while removing its duplicate catalog entry.

## 2026-07-31 — Phase 4.2 maintainability audit

Audited domain boundaries, business-rule duplication, transactions, state machines, schema constraints, errors, security, providers, tests, documentation and generated Prisma policy. Applied narrow fixes for cancellation/settlement serialization, failed-webhook retry with payload integrity, completed attempt status, non-downgrading failure events, early-refund retry, and same-edition monthly annual sources. Corrected duplicate/legacy test fixtures. Final verification passed 48 Vitest tests with five external credential-blocked skips, focused commerce Playwright 2/2, full Playwright 5/5, Prisma validation/status/no drift/seed, TypeScript, ESLint, build, runtime audit and source scans.

The audit recommends continuing to version generated Prisma output and adding a CI drift check. Phase 5 remains blocked. The separate uncommitted permanent-customer-deletion implementation conflicts with the core immutable-history rule and requires an explicit retention-policy decision before commit or production enablement. No commit was created.
# 2026-07-31 — Flexible discounts and customer offers

- Preserved annual pricing as a separate catalog calculation and added exact 0–100% promotional basis-point arithmetic.
- Added offer/redemption schema, immutable pricing snapshots, finite monthly discount schedules, renewal linkage, admin controls, and customer checkout selection.
- Fixed the initial Prisma runtime mismatch by reviewing and applying migration `20260731025700_flexible_discount_offers` to local PostgreSQL.
- Added database checks and a post-lock eligibility reload, then verified customer isolation, idempotent webhook application, zero totals, renewals, and concurrent maximum redemption.
- Updated product/customer deletion services for new restrictive relationships. Abandoned reservations remain conservative pending a provider-aware settlement-finality policy.
# 2026-08-02 — Phase 5.1 administrator MFA foundation

- Added versioned AES-256-GCM TOTP secret encryption, bounded RFC 6238 verification, QR enrollment, and keyed one-time recovery-code hashes.
- Split administrator login into password and short-lived database-backed MFA challenge stages; blocked administrator magic-link login.
- Added restricted mandatory enrollment, MFA-aware admin authorization, 15-minute password-plus-TOTP recent authentication, 60-minute idle/14-day absolute session limits, and redacted security event hints.
- Hardened administrator bootstrap against silent additional admins and protected-environment execution.
- Applied both migrations. TypeScript, ESLint, production build, 72 Vitest tests, and all five Playwright scenarios passed; five external-credential sandbox tests remained correctly skipped.
