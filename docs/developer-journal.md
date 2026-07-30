# Developer journal

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

Reused existing models and APIs; used soft archive/removal states; kept refunds provider/webhook-driven; made customer suspension revoke sessions; made license reveal one-time; kept artifact objects private.

### Files modified

Prisma schema/migration, auth/activation/download services, existing admin product/version/license APIs and pages, admin/customer Playwright suites, README, architecture, readiness and deployment documents.

### Problems and solutions

Existing minimal admin pages lacked domain metadata and operational actions. Additive fields and append-only migrations preserved compatibility. Large client tables were kept server-rendered with small mutation controls. One generated route syntax error was resolved by rewriting it in structured form.

### Next session

Complete real PayMongo/Resend certification when credentials are supplied, then plan MFA/recent-auth for privileged disclosure. The final local gate passed: 21 Vitest tests, four Playwright tests, typecheck, lint, build, migration status, and runtime critical audit.
