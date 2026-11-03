# BKE Digital Solutions — Cloudflare primary deployment with a Docker fallback

Planning date: 2026-11-03; updated 2026-11-04, Asia/Manila.
Canonical source rechecked: main at a36d9decffa6936114a9578857558a9687ca4e7f.
Owner decision: **a fresh start is acceptable**. Plan a new database and environment; do not depend on recovery of the disconnected VPS. This does not require deleting the old host, database or volumes.

Owner refinement: **retain Docker as a supported secondary deployment target**. Workers is the primary runtime; Docker remains available for a suitable VPS/container host. Share one application and business logic, with separate deployment configuration and only the necessary runtime adapters. Keeping Docker does not require keeping a VPS running.

Latest owner correction: **Google OAuth/OIDC only; no Digital Solutions account passwords.** This supersedes the original Argon2/password-hashing work. Google owns external authentication; BKE retains its principal IDs, account/role authorization, sessions, application MFA, licensing and audit controls. The initial recurring application-infrastructure target is USD 0; selected Cloudflare connection is BKE-DIGITAL-SOLUTIONS (jlprojectfreedom). Existing source requirements and actual runtime proof remain authoritative over the older planning snapshot.

Implementation tracking: [Workers compatibility PR266](https://github.com/jan2xo/bke-digital-solutions/pull/266) follows the [Google-only application consumer PR267](https://github.com/jan2xo/bke-digital-solutions/pull/267). The owner-authorized [shared Identity PR85](https://github.com/jan2xo/bke-libraries-typescript/pull/85) is merged and [identity-v0.5.0](https://github.com/jan2xo/bke-libraries-typescript/releases/tag/identity-v0.5.0) is published. This does not establish application acceptance or deployment. The primary agent maintains plans and acceptance contracts; the owner-selected GPT-6 Luna low-effort subagent implements code. Earlier password-provider exploration was uncommitted scratch work and is not an adopted implementation.

Owner addition, 2026-11-04: include a unified BKE-branded PayMongo checkout in this plan. The companion [Unified branded checkout plan](BKE-BRANDED-CHECKOUT-PLAN.md) records scope, existing owners, API evidence, failure behavior and acceptance gates. This is a separate commerce workstream; it must not be mixed into the authentication patch or require recurring billing before the Workers hosting proof can finish.

This document records the migration plan and its subsequent implementation decisions. Early planning involved source inspection only; later scratch builds and shared-library CI are separate evidence and do not establish application or production acceptance. No Cloudflare application resources or production database changes have been made by this migration work.

## Recommended destination

Keep the current V3 modular application and reusable @bke capabilities. Move primary application compute to Workers, adapt hosting-specific interfaces, retain PostgreSQL semantics, and preserve a tested Node/Docker deployment of the same source.

| Responsibility | Target |
|---|---|
| Next.js storefront, account/admin UI and HTTP APIs | One Cloudflare Worker, using the framework integration selected by a compatibility proof. |
| HTTPS, public routing and static application assets | Cloudflare Worker custom domain and assets. |
| Relational source of truth | New managed PostgreSQL database. Prefer an already suitable BKE provider; if none exists, choose a managed PostgreSQL provider such as Neon after backup/region/cost review. |
| Database connection pooling | Hyperdrive, initially with query caching disabled. Hyperdrive is a connection layer, not a database. |
| Product images and retained non-software objects | R2 binding, preserving required object-key/URL behavior. Software packages remain in GitHub Releases. |
| Rate limits and scheduler locks | Existing Upstash HTTPS adapter against managed Redis. Preserve distributed and fail-closed behavior. |
| Periodic business jobs | Cron Trigger invoking bounded scheduler work; reuse PostgreSQL job history/retry state and existing lock contracts. |
| Payments and transactional email | Existing PayMongo and Resend integrations. |
| Database recovery | Managed database backup/PITR capability with a demonstrated restore. Add protected GitHub Actions exports only where the recovery requirement needs them. |
| Software builds, release security and packages | Existing product GitHub Actions and GitHub Releases. |
| Build, certification and deployment | GitHub Actions running Node/framework/Wrangler tooling directly, with a tested immutable candidate and a protected release step. |

Start with one application Worker capable of fetch and scheduled handling. Make custom scheduled-entry support an explicit framework proof. If the chosen integration requires a separate scheduled entrypoint, use one small jobs Worker in the same repository with a narrow service binding; retain the same job ownership. Do not split each domain into a service.

The application runs on Cloudflare; PostgreSQL and the initial managed Redis service remain managed external dependencies. A requirement that every data service also be Cloudflare-native would be a separate database/coordination redesign.

## One application, two deployment targets

Proposed layout; these folders have not been implemented:

```text
app/                       # Shared UI and HTTP routes
apps/web/                  # Shared application workflows
modules/                   # Shared domain capabilities
platform/                  # Existing infrastructure contracts/adapters
deploy/
  cloudflare/              # Workers configuration and deployment entrypoint
  docker/                  # Dockerfile, Compose and optional reverse-proxy config
docs/operations/
  CLOUDFLARE-DEPLOYMENT.md
  DOCKER-DEPLOYMENT.md
  HOSTING-SWITCH.md
```

Keep framework-required configuration at the repository root where the selected toolchain needs it. Use explicit configuration paths for target-specific deployment files. A Dockerfile moved under deploy/docker must still build with the repository root as its context; moving the file does not imply copying the application into that directory.

Reuse current capability boundaries for the necessary differences:

| Concern | Workers | Node/Docker |
|---|---|---|
| PostgreSQL | Hyperdrive binding with fresh reads | Direct TLS connection to the same managed PostgreSQL database |
| Object storage | R2 binding adapter | R2 S3-compatible API adapter with least-privilege credentials |
| Rate limits/locks | Existing Upstash HTTPS adapter | Same adapter and production namespace |
| Scheduling | Cron invokes bounded job functions | A Node scheduler invokes the same functions; one active scheduler during a hosting switch |
| Sign-in | Shared Google OIDC integration, no account-password fallback | Same Google OIDC and BKE session/assurance contracts |
| Configuration | Workers bindings/secrets | Runtime environment backed by the owner secret store |

Keep licensing policy, payment settlement, entitlement rules, database schema and wire contracts shared. Runtime selection belongs in composition/adapters, not scattered checks in business code. Both artifacts must record the same source SHA and pass the relevant acceptance suite. Retain a tested container image by immutable digest for each launch candidate, using existing GitHub artifact/registry capabilities.

The container target should use the same managed data services by default. Retaining Docker is not a reason to restart the former MinIO/ClamAV stack or create a second authoritative database.

This is a compute-hosting fallback. If Docker still uses R2, it remains dependent on Cloudflare object storage. A fallback that must survive a wider Cloudflare outage needs a separately defined recovery requirement and storage plan; do not claim full provider independence from the folder layout.

## Framework choice: prove the current recommended path

The current repository uses Next.js 16.3.6 and React 19. Cloudflare now recommends **vinext** for new or migrated Next.js applications on Workers. Its current guide explicitly calls vinext beta and instructs existing applications to run a compatibility check first. Its OpenNext guide now presents OpenNext as an existing deployment path to maintain. [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/), [OpenNext guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/).

Recommendation: attempt a bounded vinext compatibility proof first. Retain the existing application structure and routes. Pin the selected toolchain in the lockfile after evaluation; do not rely on floating latest versions for releases. If it fails a required feature, document the exact failure and assess OpenNext's support for this exact Next.js version. Do not silently remove a security feature, downgrade Next.js or rewrite the UI just to obtain a build.

The proof must cover SSR/RSC, route handlers, cookies, redirects, static assets, the existing proxy.ts nonce/CSP behavior, server-only imports, runtime secrets, custom scheduled handling and any actual Server Actions/image generation used by this repository. Preserve a working Node production build for the Docker target and verify shared behavior in both outputs. A framework compatibility report is not runtime acceptance.

## Decisive migration work

### 1. Google-only identity is now the prerequisite

The owner explicitly removed Digital Solutions account passwords from the desired product. Stop the native/WASM Argon2 migration. Implement Google OpenID Connect through the authorization-code flow with state, PKCE and nonce, verified Google signature/issuer/audience/expiry, safe redirects and bounded one-time login context. Request only the identity scopes needed for sign-in; no Google API access-token/refresh-token storage is needed merely to maintain a BKE session.

Preserve BKE User.id as the internal principal. Bind the validated Google issuer/subject to it; email is profile/contact data and cannot silently merge or grant access to an existing account. New users default to CUSTOMER, while owner/admin grants remain explicit. Preserve application MFA and recent-auth protection; Google SSO alone must not be labeled as completed application MFA.

The published Identity 0.5.0 now supplies the shared Google binding/session and application-factor capabilities. Adopt its immutable artifact in Digital Solutions and certify the actual receiving application paths; package publication does not prove them. Only the necessary additive identity mapping/session-enum migration and its matching generated client are justified; do not rewrite migration history or perform unrelated Prisma hardening. Browser login/signup, admin MFA/step-up, password recovery/change retirement and native account/browser handoff need coherent receiving-path coverage. Other library consumers can retain their password capabilities; Digital Solutions must not expose them as an authentication fallback.

**Owner-approved sensitive-action policy, 2026-11-03:** use a fresh BKE application-factor challenge tied to the exact active Google-authenticated BKE user/session. It replaces the BKE password recheck, has expiry, attempt limits and single-use consumption, preserves administrator/recovery requirements and does not silently enroll a customer in MFA. Ordinary Google login is BASIC; ordinary Google plus app MFA is MFA_VERIFIED with no recent-auth timestamp. Explicit sensitive-action completion may record recent application-factor verification; it must not claim fresh Google Account authentication. The decision is preserved in [PR85](https://github.com/jan2xo/bke-libraries-typescript/pull/85#issuecomment-6598191698).

Google does not support forced Google Account reauthentication. Its optional auth_time claim requires a published, verified application with session-age claims enabled. Requiring a fresh auth_time for every sensitive action would therefore create an availability restriction that the owner declined. Do not substitute ID-token iat, a new authorization code or account selection for fresh primary authentication. [Google Security bundle](https://developers.google.com/identity/siwg/security-bundle).

Google authentication removes the password-hashing requirement, but SSR, token verification, signing, database work and concurrency still require actual Workers Free resource proof. Real Google sign-in also requires an owner-configured OAuth client and exact redirect URLs; fixture tests do not establish that live boundary. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

The owner confirmed the public website origin as `https://jl-bke.com`. The Google Web application client must register `https://jl-bke.com/api/auth/google/callback` as its exact authorized redirect URI; the application will implement `/api/auth/google/callback` using its validated canonical APP_URL. If a JavaScript origin is configured, use `https://jl-bke.com`. The route is an agreed implementation contract and is not live yet. Keep the client secret in protected deployment configuration only.

The owner reports creating public Client ID `762330940636-uuqstj4ig6ads84nid0bik35jkum4kt1.apps.googleusercontent.com`; configure it as the expected GOOGLE_CLIENT_ID audience. No client secret or credential JSON was requested or received. Exact redirect registration, audience access, secure runtime secret configuration and real Google sign-in remain live acceptance gates.

### 2. Adapt database access without changing the database model

The host currently has a process-global pg Pool, a separate module-level Prisma client, and a globally cached capability composition. Wire both raw pg and Prisma to the actual Hyperdrive binding. Make connections and clients request/operation scoped, with reliable cleanup. Cache immutable definitions rather than live sockets owned by a prior invocation. Some library repositories already create/end a pg Client per operation and can retain that useful pattern.

Preserve full transaction/session semantics: BEGIN/COMMIT/ROLLBACK, row locks, serializable/conditional claims and current conflict behavior. Account ownership transfer, invitation acceptance, Google registration/binding and operator recovery with session revocation depend on atomic PostgreSQL work.

Use the current Prisma 7.9.1 adapter approach where compatible. Verify its generated client runtime/bundling configuration using the version-specific guide. Preserve the existing data model and append-only migration history except for the explicitly necessary additive Google identity mapping/session-method change. Do not turn this into Prisma hardening, an ORM upgrade or a D1 migration.

Disable Hyperdrive query caching initially for the entire application connection. Cached revocation, membership, device or entitlement reads could authorize stale state, and Hyperdrive does not invalidate cached SELECT results after writes. One fresh connection configuration is simpler than introducing separate cached security data paths.

Sources: [current Pool](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/apps/web/persistence/postgres.ts#L5), [Prisma host](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/platform/host/db.ts#L1), [Hyperdrive Prisma integration](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/prisma-orm/), [connection troubleshooting](https://developers.cloudflare.com/hyperdrive/observability/troubleshooting/), [query caching consistency](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/), [Prisma v7 Workers guide](https://www.prisma.io/docs/guides/v7/deployment/cloudflare-workers).

### 3. Replace operating-system jobs with bounded scheduled work

Retain useful jobs: email outbox, payment operations, renewal recovery, entitlement expiry, expired authentication cleanup and retained object cleanup. Use a Cron-triggered scheduled handler with bounded batch sizes/deadlines. Preserve durable job history, retries, abandoned-run recovery, idempotency and distributed lock ownership. Test overlapping invocations and failure after a side effect.

Do not port scripts/backup-worker.ts's forever loop into Workers. lib/backups/engine.ts invokes pg_dump, pg_restore and psql; those belong in the database provider's recovery system or an authorized disposable Actions job, not the Worker. The Docker fallback uses the same recovery ownership by default. Update scheduler backup jobs and the admin backup UI/API together so they do not keep creating operations that have no executor.

Start without Queues or Workflows. Add a Queue only if measured job duration/volume needs independent retries or batching beyond the Cron budget. An HTTP waitUntil call is not a substitute for a durable business job.

Keep the existing Upstash HTTPS rate-limit/lock adapter initially. Cloudflare's native rate-limit binding is approximate and location-local, so it is not a drop-in replacement for a global security counter or a distributed lock. [Scheduled handlers](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [rate-limit locality/accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### 4. Retire the obsolete server topology coherently

Current software upload endpoints return 410 and the scanner UI/API points to GitHub authority, while production Compose still requires ClamAV and MinIO. Replace this dependency graph as part of the new target, including readiness and configuration checks.

- Remove ClamAV from the application runtime and its required health/config dependencies. Confirm product release-security responsibilities remain enforced in the relevant GitHub workflows.
- Replace retained product-image/object operations with an R2 adapter. New software uploads remain retired.
- Remove the MinIO server and its initializer from the Workers deployment path.
- Replace Caddy routing/TLS with the Worker custom domain. Resolve obsolete local Agent installer routes against the current Download BKE contract.
- Add Workers deployment/configuration/health checks and maintain separate Docker build/deployment checks. Refactor existing scripts into explicit targets; update paths and callers together.
- Replace filesystem backup assumptions in the primary runtime and remove unnecessary Chromium/operating-system tooling from its artifact. Keep only the tools justified by the Docker fallback's responsibilities.
- Update readiness to test only actual required dependencies, rather than the retired MinIO/scanner stack.

Keep Docker as maintained source, not merely archived history. Supersede obsolete Compose topology only after the replacement Docker target is tested. Label old deployment instructions clearly; a normal operator command must select its target explicitly and must not accidentally resurrect retired artifact services.

### 5. Preserve security and native contracts

Adapt runtime configuration through Workers bindings/secrets. Keep build-time values separate from runtime secrets and validate at the correct boundary. Preserve protocol bke.licensing.v3, issuer/key IDs, lease/policy formats, key history and active signing-key rules. Fresh database permission does not by itself establish a new trust root accepted by installed Agents.

For the fresh environment, choose authentication/session/encryption secrets deliberately. Preserve or explicitly bootstrap licensing/update trust under the existing protocol, then prove Agent interoperability. Never generate keys merely because a deployment starts.

Keep recoverable copies of required signing, encryption and pepper material in the existing owner-controlled secret store. Database backups alone cannot recover encrypted provider/MFA data or signing authority. The isolated restore exercise must prove the restored data works with the corresponding authorized key material, without putting secret values in logs or repository evidence.

Test cookie scope/Secure/SameSite, same-origin and CSRF checks, CSP nonces, recent-auth/MFA, trusted client IP/proxy handling, raw PayMongo signature verification, replay/conflict behavior and fail-closed dependency errors. WAF/TLS complements these application controls.

The current release verifier already validates small metadata and ZIP structure via bounded HTTP ranges, rather than executing unzip or downloading whole packages. Preserve it; cap the response stream before allocation so a malformed range response cannot defeat the intended limit. Its CPU/memory/network behavior needs a Workers test, not a new service. [Verifier](https://github.com/jan2xo/bke-digital-solutions/blob/a36d9decffa6936114a9578857558a9687ca4e7f/platform/distribution/github-standalone-release.ts#L307).

## Implementation sequence and acceptance gates

| Stage / proposed PR | Concrete result | Exit evidence |
|---|---|---|
| 1. Google prerequisite, then Workers compatibility proof | Independently certified Google Identity support, coherent Google-only consumer, pinned framework/toolchain, real login/DB/signing slice and safe database lifecycle; Node production build preserved. | Google assertion/session/MFA/collision/replay tests, application build and workerd preview; no reachable native password bindings; DB/signing vectors; proxy/CSP/cookies; credible startup/CPU/memory evidence. Stop on a precise blocker. |
| 2. Complete runtime adapters | All current raw pg/Prisma/capability paths use the correct request context; secrets/config use Workers semantics; auth, commerce, account and Agent APIs function through the new host. | Existing relevant suites plus receiving-path tests; second/concurrent invocation tests; session/account/revocation and transaction failure tests on isolated PostgreSQL. |
| 3. Storage/jobs/topology | Worker R2 binding plus Node S3 adapter, Upstash HTTPS, shared bounded job functions, provider-owned recovery, obsolete artifact dependencies removed and honest backup UI. | Image CRUD/privacy on both targets, overlapping/retried jobs, no doubled settlement/email/entitlements, no orphan backup operations; readiness/config tests; demonstrated database restore. |
| 4. Fresh environment bootstrap and dual-target CI | New empty database, approved migration/bootstrap sequence, reviewed initial catalog/legal/admin configuration, separate staging/production resources, Workers deployment and retained Docker build. | Full migration replay and domain smoke tests; no demo artifacts/accounts; no secret leakage; both artifacts bound to exact source; container digest retained; relevant intentional certification passes. |
| 5. Staging acceptance and controlled launch | Full V3 staging on actual Workers, native Agent interoperability, Docker fallback drill and hosting-switch runbook. | Required Workers evidence; tested Docker candidate against an isolated copy of equivalent state; scheduler handover and return-to-Workers demonstrated; intended production artifact and dependencies verified after authorized cutover. |

The first PR is deliberately a working vertical slice: a successful static page alone would miss the most difficult parts. Use an isolated test database and fixture credentials/keys, not production credentials or customer data.

Preserve existing intentional certification triggers rather than creating redundant push/PR workflows. Run Node/framework/Workers tests directly on GitHub Actions. PostgreSQL tests can use an isolated managed test database or a runner PostgreSQL process. Add a focused build and runtime smoke check for the retained container target when the shared runtime or deployment configuration changes, and before certifying a launch candidate as fallback-ready. Signing, dependency restoration and adapter versions must be traceable to the exact candidate.

## Fresh start procedure

1. Create a separate managed PostgreSQL database and R2 bucket for staging.
2. Replay the current approved migrations/bootstrap sequence without squashing or rewriting it. Verify all domain tables and constraints through real application operations.
3. Review the production bootstrap separately from prisma/seed.ts. The existing seed contains demo installer/artifact records and template legal text; do not run it blindly against the fresh production database.
4. Add only real initial product/catalog configuration and approved legal content. Create the owner administrator through the established secure flow, with MFA and no committed/default password.
5. Configure test providers and fixture signing identities in staging; keep staging unable to send real production payments/email.
6. Create production resources separately after acceptance, repeat the same migration/bootstrap sequence, and configure production secrets/providers through protected operations.
7. Keep any old host/data untouched. The migration does not depend on them and does not authorize their deletion.

## Required end-to-end acceptance

- Google signup/sign-in/logout, any required contact-email verification and application MFA/step-up work in the selected runtime. Invalid issuer/audience/signature/nonce, replay, wrong-subject linking and expired state fail correctly. Digital Solutions password signup/login/change/reset and misleading UI are retired coherently.
- Account switching, organization membership and seat authorization reject wrong-account or stale/revoked access.
- Verified payment events are replay-safe; success redirects cannot mint entitlements; gifts/claim redemption, refunds and lease effects remain correct.
- Agent account-session rotation/replay handling, provisioning, Repair and Update produce compatible policies and signatures with the intended key identity.
- Actual desktop Agent/Launcher interaction is exercised separately from source CI. Source tests do not certify native install/runtime behavior.
- No authenticated response or authorization query is served from an inappropriate shared cache.
- Required scheduled work survives retry and overlap without duplicate business effects.
- R2 image operations enforce the existing boundaries and software packages continue to come from GitHub Releases.
- The fresh PostgreSQL database can be restored into an isolated target within the chosen recovery objective.
- The intended Worker version and exact source/build identity are confirmed at the public origin after deployment.
- The Docker artifact built from the same source passes critical auth, database, signing, image and job behavior checks. It can read/write equivalent state without a data conversion.
- A hosting-switch drill preserves the public origin and key identity, disables the old scheduler before enabling the new scheduler, and prevents duplicate business effects. A folder or successful image build alone is not fallback acceptance.

## Release and rollback

Use an exact certified source revision and reviewed configuration. Keep the first release schema-compatible with the current model; run no opportunistic destructive migration. Deploy staging first. Production activation, credentials/provider enablement and domain cutover are consequential operations and belong to the separately authorized release step.

Retain a known-good Worker artifact and configuration for subsequent rollback. On the first launch there may be no prior functional service: rollback can mean returning to maintenance mode and disabling scheduled writes, not reviving the disconnected VPS.

Maintain the Docker fallback as a separate hosting-switch option. Before switching, provide a suitable host, the certified image digest, direct database access, R2/API credentials and matching signing/configuration material. Verify host health and the target application privately, coordinate active requests and scheduled writes, then switch routing. Run the same health/auth/licensing checks after switching. Keep production payments, webhook routing, public origin and key identity consistent. Test this procedure with isolated state before calling it ready.

A cold fallback still takes time to provision a host, install the runtime, retrieve secrets/image and change routing; retaining Docker does not create instant or automatic failover. Do not keep an idle VPS running unless an actual recovery-time requirement justifies it.

Worker rollback does not undo database writes, external payments, email or signing-policy issuance. Once production accepts writes, preserve database authority and reconcile in-flight events; do not restore an old database snapshot as a routine code rollback. Validate any backup restore in isolation first.

## Economy and remaining uncertainty

This keeps the existing repository, business capabilities, PostgreSQL behavior and a maintained Docker option. It introduces only the managed facilities needed for the Workers primary target. D1, KV-based authorization, Durable Objects, Queues, separate domain services and a new artifact server are not initial requirements.

Budget against measured Worker CPU (including SSR, Google token verification and signing), managed PostgreSQL storage/backups/connections, managed Redis operations and R2 use. The owner targets USD 0 initially; do not activate paid subscriptions, metered exposure or upgrades implicitly, or promise free hosting/performance before measuring real paths.

Unproven: this exact app has not been built or run on Workers; no native package was downloaded and matched byte-for-byte to the source tags during the compatibility review; full upstream advisory/session-lock inventory is not complete. Verify those parts in Stage 1/2 rather than treating planning as certification.

**Current next action: resolve the application consumer's exact-head certification failures, complete its Google/native acceptance gates, then resume the Workers proof.** The shared Identity release is complete. The decisive hosting result remains a real Google-authenticated V3 application + PostgreSQL transaction + compatible signing path on workerd, with the Node production target preserved. Workers is the primary target; Docker must pass its own fallback acceptance using the same application and state contracts.

The unified branded checkout workstream is now included in the roadmap. Begin with the existing Payments/Commerce contract extension and a sandbox QR Ph vertical slice, then gated cards/wallets and licensing regression tests. Automatic subscriptions are conditional on merchant enablement and approved recurring-consent/business policy. Neither the new plan nor an example invoice authorizes a live charge or a pricing change.

