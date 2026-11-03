# V3 PostgreSQL readiness baseline

**Status: PARTIAL / source investigation only. Production remains LOCKED.**  
Baseline: `a36d9decffa6936114a9578857558a9687ca4e7f` (verified as current `main` during this change).  
Scope: managed PostgreSQL foundation, kept independent of Google OAuth and the Workers application-composition work in PRs #266 and #267.

## Decision

Use **Neon Free as a candidate for a zero-cost initial development/preproduction foundation**, not as an unconditional production recommendation. Preserve PostgreSQL as the system of record. Keep the application on its existing Prisma/PostgreSQL domain model; use Cloudflare Hyperdrive as a Workers connection/pooling boundary when the owner separately authorizes and provisions it. Keep the current Node runtime and Docker PostgreSQL path as a cold local/operational fallback. This PR does not provision a Neon project or Hyperdrive binding, create credentials, activate billing, change application composition, or claim production readiness.

A free tier is a resource ceiling, not an availability or durability promise. A production launch decision requires observed workload fit, verified account/region/plan, a successful isolated restore, and owner authorization. No region or provider resource has been provisioned by this work.

## Baseline source inventory

Inspected on the verified baseline:

- `package.json`: Prisma CLI/client and `@prisma/adapter-pg` are pinned to 7.9.1; `pg` is declared at ^8.16.3. Existing scripts include `db:generate`, `db:deploy`, `db:status`, `db:smoke`, and certification commands.
- `prisma/schema.prisma`: datasource provider is PostgreSQL. The schema contains commerce, orders/payments/invoices, account membership, licenses/subscriptions, sessions/MFA, audit/security events, scheduled jobs, and backup state. This is not a D1 migration target.
- `prisma.config.ts`: Prisma migration datasource uses `DIRECT_DATABASE_URL || DATABASE_URL`; this needs to remain distinct from a pooled application connection when a provider requires a direct migration endpoint.
- `prisma/migrations/migration_lock.toml`: provider is `postgresql`.
- `docs/architecture.md`: payment confirmation, invoice finalization, and entitlement issuance are intended to occur in one serializable transaction; unique provider event/payment/order-item license constraints support replay safety. Other described operations rely on serializable transactions and PostgreSQL-backed invariants.
- `docs/backup-strategy.md` and `docs/restore-procedure.md`: existing application backup design creates encrypted PostgreSQL custom-format archives, manifests/checksums, and isolated restore workflows. The docs explicitly say production RPO/RTO is not yet asserted; production-sized restore remains a launch gate. The current implementation has documented memory-buffering and 1 GiB scratch-volume limitations on its existing Docker path.

This baseline did not change any application transaction, schema, migration, session, MFA, OAuth, Agent protocol, or licensing-signature code. A complete source-level audit of every raw `pg` caller and transaction site, and a running application-level PostgreSQL integration suite, remain acceptance gates rather than implied achievements.

## Neon Free: candidate limits and operational implications

Official Neon plan/FAQ material reviewed 2026-11-03 reports:

| Resource | Free allowance | Operational consequence |
| --- | --- | --- |
| PostgreSQL storage | 1 GB per project, 20 GB account-wide | Growth beyond the cap blocks writes that increase storage; no free-tier overage billing is expected, but the application can become unable to accept writes. |
| Compute | 100 CU-hours per project/month; autoscaling up to 2 CU | At 0.25 CU, 100 CU-hours is about 400 compute-hours. Exhaustion suspends compute until reset or upgrade. |
| Idle behavior | Scale to zero after 5 minutes; cannot be disabled | First request after idle can incur cold-start latency. |
| Public network transfer | 5 GB/project/month | Exhaustion suspends compute; estimate from realistic traffic and backup/restore activity. |
| Branches | 10 per project | CI/test branches must be reclaimed; do not create a branch per run without cleanup. |
| Instant restore | Up to 6 hours of history, capped at 1 GB of changes | This is not a substitute for independent encrypted exports or a tested restore. |
| Manual snapshots | 1 | Limited safety net; verify export and restore independently. |
| Monitoring history | 1 day | Export operational evidence if longer retention is needed. |

Source pages disagree on storage: the plan overview still displays 0.5 GB, while the newer Free-plan FAQ and October 2, 2026 provider announcement state 1 GB/project and 20 GB across projects. Treat the console's effective quota as authoritative at provisioning time and recheck before launch. Limits and terms can change.

**Cost risks:** Free is $0/month only while within current Free allowances and features. Hitting compute/egress limits can suspend service; storage exhaustion can reject writes. Moving to a paid plan changes the cost model. Do not enable billing or upgrade automatically. Set owner-visible usage alerts where available, monitor compute/storage/egress, and require approval before paid activation.

**Region:** no project exists for this intent, so there is no verified selected database region. At provisioning time, choose a Neon region with a supported low-latency path from the intended Cloudflare/Hyperdrive origin and the primary user population; record the exact provider region and measure actual round-trip latency before acceptance. Do not infer a region from the owner’s location or create a resource without authorization.

## Connection contract

### Node runtime / Docker cold path

- Keep `DATABASE_URL` as the runtime connection contract and `DIRECT_DATABASE_URL` as the direct migration/administrative endpoint where the provider supplies a separate direct endpoint.
- Continue to use the existing Prisma PostgreSQL adapter and `pg` driver. Do not introduce a second persistence abstraction or rewrite generated Prisma code.
- Keep pool sizes bounded and explicit. Close pools in finite CLI/test processes; do not repeatedly create a new pool per query. On shutdown, drain the pool before process exit.
- Treat connection reset, timeout, refusal, authentication failure, pool exhaustion, and provider suspension as explicit failures. Never convert a failed authorization read into an allow decision or silently fall back to stale cached entitlements.

### Cloudflare Workers / Hyperdrive seam

This PR deliberately does **not** implement Sol's Worker runtime or modify application composition. The later integration should provide a request-scoped connection/client factory that accepts a connection string from a Hyperdrive binding, while retaining a Node factory for the cold path. Do not cache a connection/client globally across Worker invocations when the driver/runtime forbids cross-request I/O reuse. Use a bounded per-request client/pool and release resources in a `finally` path.

Hyperdrive uses transaction-mode pooling. A connection is pinned for a transaction and returned after commit/rollback; session-level state must not be assumed to persist between transactions. Preserve transaction boundaries and avoid relying on session advisory state, temporary tables, session variables, or session-affine prepared state unless separately demonstrated compatible. Validate every raw `pg` and Prisma interactive-transaction path through the intended binding before enabling it.

Use two Hyperdrive configurations only if justified: (1) normal cache-enabled reads that explicitly tolerate staleness; (2) a cache-disabled binding for authorization-sensitive reads. The following must always use fresh database reads: session revocation/validity, account membership and permissions, MFA/recent-auth state, order/payment finalization checks, Claim Code redemption state, entitlement/license state, and any read immediately following a security-relevant write. Hyperdrive does not invalidate cached SELECT results after a write. A comment or SQL function-name trick is not a cache control. Configure the fresh binding with the provider's explicit caching-disabled setting and route security-critical reads through it.

## PostgreSQL semantics that must remain invariant

- Commerce: payment confirmation, invoice finalization, and entitlement issuance remain atomic and idempotent. Preserve serializable isolation where the current implementation requires it and preserve unique conflict handling.
- Claim Codes and one-time actions: concurrent redemption must not produce more than one successful consume/entitlement; rollback must release all related changes.
- Accounts and authorization: membership/role changes and session revocation must be visible on the next authorization decision. No cache may extend a revoked session or stale permission.
- Licensing: signing payloads and signatures remain byte/contract-compatible; this PR does not change licensing signatures or their producer/consumer contracts.
- Transactions: `BEGIN`, `COMMIT`, `ROLLBACK`, row locks (`FOR UPDATE`, `SKIP LOCKED`), uniqueness, foreign keys, partial indexes, PostgreSQL enums, triggers, and serializable retry behavior must be tested against PostgreSQL itself—not approximated with SQLite or D1.

## Migration and schema procedure

1. Pin and record the exact application commit and provider/database version.
2. Create an empty disposable PostgreSQL database using the same major version as the target provider; do not use production credentials.
3. Run `npm ci`, `npm run db:generate`, then `npm run db:deploy` against the disposable database. Never run `prisma migrate dev` against a shared/production database.
4. Run `npm run db:status`, `npm run db:smoke`, and the full focused application certification suite. Capture migration names and hashes, table/index/constraint counts, enum definitions, trigger/function definitions, and representative row counts.
5. Replay all committed migrations from an empty database in CI. Do not edit already committed migration files; add forward migrations only.
6. Compare the final schema with Prisma's generated schema and inspect PostgreSQL-only constructs. Exercise a second clean replay to catch non-idempotent setup assumptions.
7. For later Google Identity integration, adopt the exact released `@bke/identity` 0.5.0 package only after verifying immutable release bytes and its schema/migration contract. PR #267's pending `google_oidc_identity` migration must be reviewed as a downstream migration after its integration gate. Do not cherry-pick/rewrite migrations, resolve conflicts by dropping existing data, or claim migration compatibility until clean replay and upgrade-from-baseline tests both pass.

## Backup, export, and restore

- Keep the existing encrypted PostgreSQL custom-format export and private-object backup design for the Node/Docker path. Store encryption keys separately from archives and source credentials.
- Before any migration or provider cutover, take an encrypted logical export and preserve the manifest/checksums outside the source database/provider failure domain.
- Restore into a new isolated database and new isolated object bucket, never into the source. Validate archive authentication, hashes, migration status, table counts, foreign-key/integrity checks, and representative account/order/invoice/payment/license/Claim Code/audit records. Run `db:status` and `db:smoke`; record elapsed time and row-count deltas.
- Neon Free instant restore is limited to a six-hour history window with a 1 GB change-history cap and only one manual snapshot. This is not adequate as the only recovery mechanism. The existing repository backup design itself still has documented buffer/scratch limitations and no measured production RTO. Production recovery remains uncertified until a representative restore is demonstrated.
- Define and owner-approve RPO/RTO, archive retention, encryption-key recovery, provider outage response, and the paid-plan escalation decision before production.

## Acceptance ledger

| Gate | Current state |
| --- | --- |
| Baseline main SHA verified | PASS: `a36d9decffa6936114a9578857558a9687ca4e7f` |
| Prisma/PostgreSQL dependencies and datasource contract inventoried | PARTIAL PASS: manifest/config/schema inspected |
| Full raw `pg`/transaction call-site audit | PENDING |
| Clean migration replay on disposable PostgreSQL | PENDING |
| Commerce / Claim Code / entitlement concurrency tests | PENDING |
| Rollback, row-lock, session-revocation freshness tests | PENDING |
| Worker/Hyperdrive connection lifecycle and failure tests | PENDING; requires Sol's later runtime seam |
| Isolated restore on disposable PostgreSQL | PENDING |
| Neon region/account/plan verified | NOT PROVISIONED |
| Production approval | LOCKED |

No source-level or provider-level acceptance is implied by this document. Update this ledger only with exact commit, CI run, and test evidence.
