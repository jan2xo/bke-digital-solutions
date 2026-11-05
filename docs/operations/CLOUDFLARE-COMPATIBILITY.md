# Cloudflare Workers Free compatibility proof

This document tracks the first hosting-migration intent. It is not deployment approval or evidence that Digital Solutions runs on Workers.

## Accepted result and boundaries

Starting source: `a36d9decffa6936114a9578857558a9687ca4e7f` on canonical `main`.

The owner authorized implementation from the 2026-11-03 V3 free-tier handoff, accepted a fresh database, and retained Docker as an optional cold target. The owner subsequently required Google OAuth/OIDC only, with no Digital Solutions account passwords; that correction supersedes the handoff's Argon2/password requirements. The initial application-infrastructure objective is USD 0 for 1–3 customers. Paid upgrades, metered subscription activation, production cutover, live credentials and native Agent changes are outside this intent.

The canonical shared Identity prerequisite is tracked in [bke-libraries-typescript PR85](https://github.com/jan2xo/bke-libraries-typescript/pull/85). Adopt an independently certified immutable package before claiming Google-authenticated application compatibility.

### Current staging authorization

The earlier boundary above describes the initial migration intent. The owner later directed the team to use the Cloudflare-owned workers.dev origin and continue the discussed steps. This explicitly authorizes progressing isolated staging setup and a test deployment on eligible Free resources after review and required protected configuration are ready. The Worker has since been deployed to isolated Staging as version `c6f8051d-d071-4e70-8bef-a4d28146f884`; this establishes deployment only, not production acceptance. Keep the apex/production cutover, paid activation, production data, and unapproved security-access grants outside this authorization. Do not put staging secrets in ordinary PR or fixture CI; any actual staging deployment must use a separate protected operation.

### Protected isolated Staging runbook

The existing `CI` workflow has a manual `deploy_staging` input defaulting to `false`. A deploy requires the exact selected `source_sha`, an equal `github.workflow_sha`, and success from every core certification job. Staging deployments and migrations serialize with cancellation disabled. The target is the Cloudflare-owned workers.dev origin above; the apex and production are outside this path.

Before any deploy-enabled run, an owner must verify the actual GitHub `Staging` environment has required reviewers and branch restrictions. The environment name alone does not establish protection. Only after that review may the owner create the Infisical OIDC identity/access policy and the environment-scoped Cloudflare deployment token. The identity should bind the verified immutable subject `repo:jan2xo@163499503/bke-digital-solutions@1316972505:environment:Staging`, repository ID, and trusted workflow/ref. Verify the repository's actual OIDC subject prefix in Settings instead of assuming legacy subject names, and use no wildcards. The job authenticates to Infisical with GitHub OIDC only and reads the dedicated Free-tier Staging-only project `BKE DIGITAL SOLUTIONS STAGING` (`f029af60-06f3-428c-b305-c70f8bcf7850`) at environment `staging`, root path, without imports or recursion. Its built-in project-scoped `Viewer` role is read-only. Keep production and shared secrets out of this project. The original project `64133fed-7cb1-471b-80e4-4a9e7b44653b` and its data/history remain unchanged; the Staging identity is not granted access there. The Cloudflare token is step-scoped to metadata verification and deploy; it is never a Worker runtime secret.

Required protected config includes independently set `STAGING_NEON_HOST` equal to the exact direct Neon hostname, plus Infisical `DATABASE_URL` and `DIRECT_DATABASE_URL` using that host, database `bke_staging`, role `bke_staging_owner`, port 5432 and TLS. Hyperdrive `bke-digital-solutions-staging-fresh` must match host/database/role, use PostgreSQL port 5432 and have caching disabled. The approved namespace values are exactly `DEPLOYMENT_ID=bke-digital-solutions-try` and `REDIS_KEY_PREFIX=bke-digital-solutions-try`. Initial staging uses mock payments, log-only email and `PAYMONGO_LIVEMODE=false`.

The job prepares and validates a private explicit runtime allowlist before applying existing reviewed migrations. Direct database URLs, Cloudflare deployment credentials, account metadata and Infisical OIDC metadata are excluded from Worker configuration/secrets. Do not seed demo/catalog/admin data, promote accounts by email, or enable scheduled Cron. Temporary Wrangler config and secret files are removed after every outcome. This path is limited to eligible Free resources and does not establish production acceptance.

**Product images and downloads:** Product images use public GitHub repository URLs restricted to canonical PNG/JPEG/WebP files under `raw.githubusercontent.com/jan2xo/`; the application stores the URL and does not fetch or copy image bytes. Downloadable product artifacts remain GitHub Release links through the existing licensed delivery flow. This path requires no S3 or R2. Existing object-storage cleanup and backup facilities remain optional legacy operations and fail explicitly when invoked without configuration.

**OAuth logging privacy and public acceptance:** The deployed baseline was observed with persisted logs enabled and query-string redaction disabled. Do not run the real Google OAuth flow until a protected deployment applies and verifies the source-controlled `observability.redact_query_string: true` setting; the pinned Wrangler 4.157.0 supports this field. Logging remains enabled; tracing configuration is unchanged. Each deploy-enabled workflow run now makes fixed-origin, unauthenticated requests to `/`, `/login`, and `/api/health/ready` after deploy and before cleanup. It requires 200 HTML with the Google sign-in affordance and 200 JSON readiness with PostgreSQL, Valkey, and provider checks up and no primary object-storage dependency. The public smoke uses no cookies, does not follow redirects, and never sends the Cloudflare API token to the Worker. This smoke does not prove Google provider sign-in. [Pinned Wrangler change](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.157.0/packages/workers-utils/CHANGELOG.md).

**Staging legal test notices:** The only initial registration notices are [Staging Test Terms](../legal/staging-test-terms.md) and [Staging Test Privacy Notice](../legal/staging-test-privacy.md). The existing manual CI input `initialize_staging_legal` defaults to `false`; it runs only when explicitly enabled for the same protected Staging deployment, after successful deploy and verified query-string redaction. It creates only those two published document/version pairs and a null-actor audit record, and only when there are no users or existing legal rows. An exact rerun is a no-op; unexpected existing state fails closed. It does not create users, administrators, acceptances, catalog data, orders, licenses or artifacts. Registration still records each user's acceptance through the existing flow. These are clearly labeled Staging notices, not production terms or privacy policy. The opt-in remains disabled until the owner separately approves publication of the exact reviewed notice source and commit.

**Operator prerequisites:** Neon credential transfer into the dedicated protected Staging Infisical project, actual GitHub environment protection, the project-scoped read-only Viewer identity authenticated by OIDC, Cloudflare token, independent `STAGING_NEON_HOST`, Redis, approved stable signing/secret keys. No S3 or R2 resource is required for GitHub-hosted images or GitHub Release downloads.

**Prior certification:** [CI #2270](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41835344651) passed exact source/workflow `982aece38f966b8ca70ad5bf40cbfaec57dcfe6e`: 740 passed, 5 skipped, all five core jobs passed, bundle size 15,854,468 bytes. CI #2276 passed all five core jobs, aggregate certification and the protected Staging deployment at exact source/workflow `51784c69034267c3df843b8b349fa7e656b927fd` ([run](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41985060439)). It applied the reviewed migrations to the fresh Neon Staging database and deployed Worker version `c6f8051d-d071-4e70-8bef-a4d28146f884`. That run did not include the query-redaction setting or a public post-deployment smoke, and does not establish Google sign-in acceptance.

## Google OAuth client contract

The saved isolated Staging origin is `https://bke-digital-solutions.jlprojectfreedom.workers.dev`. The existing apex `https://jl-bke.com` remains in the live production OAuth configuration and is not used for this staging deployment.

- Google client type: Web application.
- Owner-supplied public Client ID: `762330940636-uuqstj4ig6ads84nid0bik35jkum4kt1.apps.googleusercontent.com`. Configure this as the consumer's expected `GOOGLE_CLIENT_ID` audience; the client secret is not part of this document.
- Authorized Staging redirect URI: `https://bke-digital-solutions.jlprojectfreedom.workers.dev/api/auth/google/callback` (exact match; no trailing slash or wildcard).
- Authorized Staging JavaScript origin, if configured: `https://bke-digital-solutions.jlprojectfreedom.workers.dev`.
- The consumer must implement `/api/auth/google/callback` and derive its exact redirect URL from the validated canonical `APP_URL`, rather than untrusted request headers. This is an implementation contract, not a live route claim.
- Use only identity scopes needed for sign-in. Keep the client secret in protected deployment configuration; never in GitHub, browser code, Notion or review comments. The owner saved the exact Staging redirect URI above; that callback setting is verified. Audience access and actual provider acceptance remain unverified.

The owner approved fresh BKE application-factor verification for sensitive actions under Google-only authentication. Bind each expiring single-use challenge to the exact active BKE user/session, preserve administrator enrollment and recovery controls, and distinguish recent application-factor verification from fresh Google Account authentication. Ordinary Google login must not grant recent-auth assurance. [Decision and provider constraint](https://github.com/jan2xo/bke-libraries-typescript/pull/85#issuecomment-6598191698).

Required PR1 evidence:

| Requirement | Required receiving-path proof | Boundary |
|---|---|---|
| Framework | Existing V3 SSR/dynamic browse and authenticated dashboard, cookies, CSP/nonce, server-only/runtime configuration and static-asset routing | Actual application build and workerd; deployed staging remains separate |
| Identity | Google OIDC receiving-path proof, stable provider-subject binding, valid/invalid/replayed assertions, app-owned session/MFA/recent-auth protection and second/concurrent invocations; password endpoints retired in the consumer | Node and Workers runtime interoperability; real Google sign-in remains separate |
| Persistence | Real PostgreSQL transaction/rollback through the chosen Workers/Hyperdrive adapter, with fresh authorization reads and safe client lifetime | Isolated database/runtime proof; no schema/history rewrite |
| Licensing | Existing Ed25519 lease/policy producer and Agent-compatible test vectors; invalid/expired/wrong-scope inputs rejected by actual consumers | Source/runtime vectors; physical/native Agent testing remains separate |
| Resources | CPU profiles, startup, bundle and memory evidence for representative operations and concurrency; explicit comparison against Free constraints | Wall-clock timers or local configuration alone cannot prove deployed CPU enforcement |
| Jobs and portability | Bounded scheduled entrypoint plus retained Node production behavior | No always-on host, no new commercial truth/cache authority |

Map the existing Agent lease/auth/account/application-session lifetimes, trusted clock, local reuse, renewal, grace and revocation semantics before proposing any changes. A 24-hour process session must not extend a signed lease or bypass an existing refresh rule.

Use the existing PostgreSQL/capability/security contracts. Preserve rate limiting, recent authentication, same-origin checks, audit boundaries and Docker source. Do not replace the product with a toy endpoint, weaken Google token verification or MFA/authorization, introduce D1, rewrite Prisma history or add automatic paid upgrades to obtain a pass. Any necessary additive identity mapping/session-enum migration belongs to the explicitly authorized Google-only authentication prerequisite, not unrelated database hardening.

## Execution and evidence

Use the existing intentional GitHub certification mechanism and bind results to the exact candidate source. Candidate workflow definitions and checked-out source can differ on comment-triggered runs; inspect what actually executed. Record implementation/checkpoint/run details in the PR conversation.

A source milestone may be implemented while the parent migration remains PARTIAL. The complete PR1 acceptance cannot be called PASS if required application/runtime, CPU or database proof is missing. On a demonstrated incompatibility, retain the smallest reproducible evidence and identify the exact failing operation. Do not advance to unrelated later waves around a failed feasibility gate.

Current status: the immutable Identity 0.5.0 prerequisite is published and adopted. The application receiving milestone passed CI #2263 at `799ba8e103de36a4bab4c197559da2978d009860`; this is not real Google/provider or deployed Free acceptance. The parent migration remains PARTIAL and production remains LOCKED. Later provisioning, native/Agent, storage/jobs and release requirements remain separate.

## Implementation candidate (2026-11-04)

The Workers branch incorporates the complete reviewed Google consumer tree at
`50d483350736c22d887a01cb23fb30de57a97107`; PR267 and main remain untouched.
OpenNext 1.20.15 requires Next >=16.4.1 on the 16.x line, so the candidate
updates Next and its ESLint configuration together. Wrangler is pinned to
the published 4.157.0 release. The lockfile is generated by npm in Actions,
exported for ingestion, and must be committed before the workflow accepts it.

The custom entry wraps the real generated application, preserving streaming
and waitUntil lifetime. Prisma, the host PostgreSQL pool and the composed
capability graph are scoped to that operation. Node retains its existing
process-lifetime reuse. Library repository methods continue to own their
operation-level Client/transaction lifecycle. No schema/history changes or
shared-package republishing are part of this adapter.

### Raw PostgreSQL ownership audit (source inspection, 2026-11-04)

| Source/call site | Ownership and behavior | Evidence boundary |
|---|---|---|
| `apps/web/persistence/postgres.ts` | Canonical host `Pool` owner. Within a Workers operation, registers a request-scoped pool through `operationResource` (max 2) and closes it at operation completion; Node keeps its process-scoped pool (max 10). | Inspected source; exact-head runtime lifecycle checks are pending Actions. |
| `apps/web/audit.ts`, `apps/web/providers/capability.ts`, `apps/web/support/capability.ts`, `apps/web/distribution/licensing-agent-update-admin.ts`, `apps/web/distribution/licensing-agent-update-authority.ts` | Host direct-pg consumers call the canonical pool owner. | Inspected source; not separate runtime acceptance. |
| `apps/web/security/events.ts` | Now delegates event inserts to `getPostgresPool()`; its former independent process-global `Pool` was removed. A unit check asserts delegation. | Source/test change is committed; test and Worker lifecycle proof are pending Actions. |
| `apps/web/health/readiness.ts` | Readiness creates short-lived pools and closes them in `finally`; left unchanged. | Inspected source; no new runtime claim. |
| Released licensing repository | Signing-key and commercial-lease repositories create operation-level PostgreSQL clients; commercial issuance uses the package transaction boundary. | Inspected released source. Workers public-key registry reads do not prove lease signing, issuance, or rollback. |

Prisma-backed application paths, including Prisma raw-query calls, remain owned
by `platform/host/db.ts` and its operation-scoped Prisma client; those are
distinct from direct `pg.Pool` call sites. This inventory is a source audit,
not proof that every listed path has been exercised in workerd.

`HYPERDRIVE_FRESH` must reference a provider configuration with query caching
disabled before any staging/live acceptance. Its all-zero ID is an explicit
unprovisioned placeholder; the local connection string is only the disposable
Actions PostgreSQL service. Neither its binding name nor local tests prove
provider cache configuration. Ordinary CI does not create or deploy resources; only the separate protected `deploy_staging=true` job can deploy, after all required certification passes.

Workers receiving proof is a required job in the existing explicitly invoked
`ci.yml`, alongside its existing database/source, Node build, Docker and security
owners. No automatic PR/push workflow remains. Select the candidate branch's
workflow definition and exact source SHA: comment runs loading main's older
definition do not include the new job. The first bootstrap run generated npm
bytes; their artifact SHA-256 and lockfile provenance are recorded in PR266.
The ingested lockfile must be unchanged by verification. Sessions are fixtures
in disposable Actions PostgreSQL, not evidence of Google provider sign-in.

Beyond the verified receiving milestone, still required: provider cache-disable verification, real Google/Redis configuration and sign-in, representative licensing/transaction receiving proof, bounded scheduled entrypoint, deployed Free CPU/startup/bundle/memory evidence and installed native interaction. The source-level raw-pg ownership audit is recorded below; runtime lifecycle/receiving checks remain subject to exact-head Actions. Keep the parent PARTIAL until those gates are resolved. PR merge and production deployment remain unauthorized; the owner's later isolated staging authorization is described above.

### Prisma runtime receiving correction

CI2261 proved that the default Node-generated query compiler dynamically
constructs a WebAssembly module, which workerd forbids. `workers:build` now
derives a temporary schema from the canonical source, changing only the
client generator's supported `runtime = "workerd"` field. The data-model
text is asserted identical. Prisma generates the Workers client through its
real CLI; no generated source is hand-edited and no migration command runs.

After OpenNext captures the Workers artifact, a finally block runs the
canonical Node generator again and verifies every generated file against
its pre-build SHA-256. Canonical schema text is also checked unchanged.
This keeps Node fixture/operator imports and Docker source on their
existing runtime while the built Worker contains static WASM imports.
A failing restoration fails the build. Node and Workers builds use separate
outputs/jobs; rebuild the intended target before starting it.

CI #2263 passed the actual workerd receiving checks after this correction,
including repeated public browse, concurrent authenticated fixture dashboards,
cross-account exclusion, and fresh session revocation. These sessions are
fixtures issued through the released Identity capability, not Google provider
sign-in. [Supported Prisma generator runtimes](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators).


## Verified receiving milestone and remaining setup (2026-11-04)

[CI #2263](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41790668399)
passed all required jobs at `799ba8e103de36a4bab4c197559da2978d009860`.
Source and executed workflow SHA matched. The source/database suite passed
739 tests with 5 skipped; Node and Docker builds passed. The Worker served
the actual application, Google login page, retired credential endpoint (410),
repeated concurrent authenticated dashboards with cross-account exclusion,
and rejected a freshly revoked session.

That run also exposed and then verified the host Legal storage correction:
the host maps its existing `versionNumber/userId` fields to the released
reacceptance repository contract. The released Legal capability still owns
validation and the decision. No schema or migration rewrite was performed.
The PostgreSQL regression checks legal holds, principal age, other-user
acceptance, correct acceptance and rollback.

The existing CI includes Wrangler's `check startup`, which internally performs
a deployment dry run and reports bundle size plus a local startup CPU profile.
It does not upload a Worker or require Cloudflare credentials. Its local
measurements do not certify deployed startup, request CPU or memory.
No profile or bundle containing configuration is published as an artifact.

As verified against current Cloudflare documentation on 2026-11-04, the
bundle limit is **64 MiB uncompressed** for Free and Paid. The former 3 MB/10 MB
compressed limits were removed on 2026-09-04. Free HTTP/cron CPU remains 10 ms;
memory is 128 MB per isolate, and startup is limited to 1 second. Capture
representative deployed evidence before accepting Free fit; do not infer
request CPU from elapsed HTTP time or this local startup profile.

Sources: [current limits](https://developers.cloudflare.com/workers/platform/limits/),
[size-limit change](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/),
[startup profiling](https://developers.cloudflare.com/workers/wrangler/commands/workers/#startup).

Owner confirmed the Cloudflare account's assigned workers.dev subdomain is
`jlprojectfreedom.workers.dev`. The existing Worker name is
`bke-digital-solutions`, so the assigned staging origin is
`https://bke-digital-solutions.jlprojectfreedom.workers.dev` and its Google
callback is `/api/auth/google/callback` on that exact origin. The application
has not been deployed and this origin is not yet live. The active `jl-bke.com`
DNS zone is in the owner's other Cloudflare account; production/apex cutover
remains a later, separate operation. Do not transfer the zone, change its DNS,
or deploy under the earlier migration boundary alone. The owner's later direction authorizes isolated staging setup and test deployment on eligible Free resources after review and protected configuration are ready. This does not authorize production/apex cutover, paid activation, production data or unapproved access grants; staging deployment uses a separate protected operation, never ordinary PR/fixture CI.

Keep the OAuth client secret, Redis token, database credentials, session secret,
application-factor encryption key, licensing pepper and signing private key
in protected configuration only. The public client ID and origin may be recorded;
secret values must not appear in source, profiles, artifacts, comments or Notion.

The owner selected the assigned workers.dev origin above for staging and confirmed
the apex site remains live on the VPS. The exact callback is
`https://bke-digital-solutions.jlprojectfreedom.workers.dev/api/auth/google/callback`.
The dedicated Staging-only Infisical project is the protected configuration
source for this deployment; the original Infisical project is unchanged. No
secret values belong in this repository. See the Google consumer contract for
delivery and the later production cutover boundary.

## Measured upload-size blocker

[CI #2264](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41794630233)
at `4655dab51cb70036f23a76c707c8ff24af41f667` passed application receiving
checks but measured **100079.55 KiB uncompressed**, approximately 97.7 MiB.
This exceeds the documented 64 MiB upload limit. That initial measurement
step only printed diagnostics, so its green result did not establish
upload acceptance. Do not deploy that artifact or treat a paid plan as a
size-limit fix.

The subsequent candidate enables supported final Wrangler minification and
adds a required size gate against the actual serialized dry-run upload.
The gate counts code/WASM/data module bytes and excludes string metadata
and source maps, matching pinned Wrangler's measurement. It prints sizes
and module/input filenames, never binding values or module contents.
Tests cover the exact 64 MiB boundary, oversized/invalid values, multipart
accounting, and missing entry modules. Minification is not presumed sufficient;
inspect the next exact-head result and the largest contributors if it fails.
No application capability is removed or externalized to make the upload fit.

CI #2265 measured the minified upload at 90,638,039 bytes and correctly failed
the size gate. Its build warning and import trace identify Turbopack's WASM
resolver expanding a dynamic pattern to 59,870 project files. The upload
contains unrelated PGlite, schema and non-PostgreSQL compiler engines, plus
repeated generated chunks. These are bundling artifacts, not required new
application responsibilities.

The next correction uses Next's supported `next build --webpack` only within
the Workers build wrapper, then OpenNext's supported `--skipNextBuild` to adapt
that exact output. Normal Node/Docker build commands remain unchanged.
The supported workerd Prisma generation and finally-based Node restoration
remain intact. This avoids hand-patching generated WASM loaders, removing
features or introducing more Workers. The exact size gate and receiving
checks must pass before treating the correction as verified.

CI #2266 stopped at the nested Webpack parser: the generated `.wasm?module`
was being treated as JavaScript. The Workers build now provides a narrowly
scoped Webpack external for that one compiler import, leaving its real WASM
module to OpenNext's existing Wrangler-external handling. A copy of the
genuinely generated PostgreSQL compiler is retained in the ignored build
output so canonical Node regeneration cannot remove the needed build artifact.
No generated source is edited and no dynamic WASM compilation is enabled.
The custom external applies only to server compilation under the explicit
Workers build flag; regular Node/Docker configuration is unchanged.
