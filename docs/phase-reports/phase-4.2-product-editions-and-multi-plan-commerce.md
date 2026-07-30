# Phase 4.2 report — Product Editions and Multi-Plan Commerce

Date: 2026-07-31 (Asia/Manila)

Status: **Complete and locally verified. Phase 5 was not started.** External PayMongo and Resend certification remain separate production blockers.

## Architecture delivered

- Stable `Product → Edition → PurchasePlan → Order → Entitlement` relationships.
- Edition-owned features, authorized-user/device limits, and update policy.
- PERPETUAL, MONTHLY, and ANNUAL plans. Annual stores no total: `roundHalfUp(monthly × 12 × (10000 − discountBps) / 10000)`, with discount limited to 0–1000 basis points.
- Browser checkout accepts exactly `{ purchasePlanId }`; every commercial and entitlement value is loaded server-side.
- Immutable order-item edition/plan snapshots; new licenses/subscriptions retain selected terms.
- Additive legacy compatibility. Existing Price/LicensePolicy and historical commerce values are not rewritten.
- Admin edition/plan controls, annual preview, catalog selection, checkout review, plan-aware customer history, and activation capability response.
- Safe deletion counts/removes disposable plans/editions; history still blocks deletion and storage failure still rolls back database state.
- Pending orders expose owner/billing-role continuation and cancellation only while pending. Stored checkout URLs are reused; legacy pending orders create a recorded replacement attempt. Provider-confirmed payment after local cancellation remains authoritative and idempotent.
- Product-specific trials issue standard licenses. Self-service eligibility is unique per account/product/UTC year across editions; administrators may add grants, set 0–14 grace days, or revoke, with every mutation audited.
- Customer and administrator key reveal is repeatable by owner direction. Encrypted key material is retained, every reveal is authenticated/authorized and audited, and plaintext is never logged. Already-erased legacy ciphertext cannot be recovered.

## Migration and seed

Migration `20260730174924_product_editions_multi_plan` was validated and applied to PostgreSQL 17. It adds nullable historical links, deterministically backfills catalog editions/plans, links existing entitlements where possible, and adds database constraints for plan shapes and limits. `20260731103000_pending_order_resume` adds nullable checkout URL storage. `20260731113000_product_trials` adds restrictive trial history and the account/product/year uniqueness boundary. The idempotent seed reuses migration-created legacy mappings, deactivates a redundant seeded edition when history prevents deletion, and never destroys trial or commerce history. All three are forward-only after production data exists; rollback requires restore/forward-fix planning rather than dropping retained data.

## Verification

The earlier 36-test Vitest run and focused 2-test Playwright run are retained as development history. The final authoritative combined verification is recorded after the complete review and supersedes those intermediate counts. Four real PayMongo sandbox cases and one Resend delivery case remain credential-blocked and must not be reported as passed.

### Final authoritative review result

- PostgreSQL 17 healthy, Valkey returned `PONG`, and MinIO readiness returned success.
- Prisma schema valid; seven migrations applied in order; database and Prisma schema have no drift; idempotent seed passed.
- Seeded catalog backfill has zero active legacy prices without a mapped plan; every annual plan has a valid same-edition monthly source. Broad unmapped rows are disposable integration-test fixtures created after migration.
- Focused pricing/pending/trial Vitest: 12/12 passed.
- Full Vitest: 45 passed; four real PayMongo and one real Resend test skipped because credentials are absent.
- Focused commerce Playwright: 2/2 passed. Full Playwright: 5/5 passed.
- TypeScript, ESLint, production build, `git diff --check`, Prisma drift check, tracked-artifact checks, and sensitive-log scan passed.
- Runtime critical dependency audit: zero vulnerabilities.

Review corrections included repeatable authenticated/audited license reveal by owner direction, explicit account selection for self-service trials, fresh entitlement checks when redeeming download grants, documentation of late payment after local cancellation, row-locked replacement reservation with controlled in-progress/stale behavior, replacement-checkout mock IDs derived from attempt idempotency keys, and focused regression coverage. No commit was created.

## Failures and corrections

1. Default-shell `npx`/`npm` were unavailable; commands used the bundled Node runtime.
2. Prisma deploy was initially sandbox-denied; the approved localhost retry passed.
3. Seed initially violated unique `legacyPriceId`; it now reuses migration-created mappings.
4. Two compressed catalog pages had syntax errors; structured rewrites fixed them.
5. Build first lacked worker permissions/path; the approved run with Node on `PATH` passed.
6. Playwright first found a stale existing server, then an ambiguous admin locator. A clean server and exact locator produced a 5/5 pass.
7. The first final focused Playwright command was blocked by a stale process on port 3000; the verified listener was stopped and the retry ran.
8. The next focused run found the mock provider reused one external checkout ID for every attempt on an order, preventing legacy checkout replacement. The mock now uses the attempt idempotency key; focused 2/2 and full 5/5 reruns passed.
9. A review scan found the admin bootstrap printed an email address. The success message is now generic.

## Security and history review

No browser-provided price, discount, quantity, account, interval, or total is trusted. Annual totals use integer arithmetic. Webhook verification/idempotency and serializable issuance remain intact. New links are nullable for legacy records. Product deletion has no force path. Storage cleanup must finish before database deletion; failure leaves the archived database state retryable. No provider secret, raw webhook payload, license key, or generated credential was added.

## Commands executed

```text
sed, rg, find, ls, git status, git diff --stat, git diff --check
<bundled-node> node_modules/typescript/bin/tsc --noEmit
<bundled-node> node_modules/prisma/build/index.js validate
docker compose ps
<bundled-node> node_modules/prisma/build/index.js migrate deploy
<bundled-node> --import tsx prisma/seed.ts
<bundled-node> node_modules/vitest/vitest.mjs run
<bundled-node> node_modules/eslint/bin/eslint.js .
<bundled-node> node_modules/next/dist/bin/next build
<bundled-node> node_modules/@playwright/test/cli.js test
lsof -nP -iTCP:3000 -sTCP:LISTEN
ps -ax -o pid=,command=
kill 4282
curl -sS http://127.0.0.1:3000/admin/products
```

## Remaining blockers

- Real PayMongo sandbox checkout/webhook/refund/reconciliation evidence and Resend verified-domain delivery.
- Production PostgreSQL, Valkey, private storage/IAM, HTTPS/domain, backups, monitoring, malware scanning/code signing, admin MFA/recent-auth, legal/privacy/tax review, and independent security testing.
- Phase 4.2 is included in the reviewed commerce commit after this report was finalized.
