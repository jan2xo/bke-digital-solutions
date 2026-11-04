# Cloudflare Workers Free compatibility proof

This document tracks the first hosting-migration intent. It is not deployment approval or evidence that Digital Solutions runs on Workers.

## Accepted result and boundaries

Starting source: `a36d9decffa6936114a9578857558a9687ca4e7f` on canonical `main`.

The owner authorized implementation from the 2026-11-03 V3 free-tier handoff, accepted a fresh database, and retained Docker as an optional cold target. The owner subsequently required Google OAuth/OIDC only, with no Digital Solutions account passwords; that correction supersedes the handoff's Argon2/password requirements. The initial application-infrastructure objective is USD 0 for 1–3 customers. Paid upgrades, metered subscription activation, production cutover, live credentials and native Agent changes are outside this intent.

The canonical shared Identity prerequisite is tracked in [bke-libraries-typescript PR85](https://github.com/jan2xo/bke-libraries-typescript/pull/85). Adopt an independently certified immutable package before claiming Google-authenticated application compatibility.

## Google OAuth client contract

Owner-confirmed public origin: `https://jl-bke.com`.

- Google client type: Web application.
- Owner-supplied public Client ID: `762330940636-uuqstj4ig6ads84nid0bik35jkum4kt1.apps.googleusercontent.com`. Configure this as the consumer's expected `GOOGLE_CLIENT_ID` audience; the client secret is not part of this document.
- Authorized redirect URI: `https://jl-bke.com/api/auth/google/callback` (exact match; no trailing slash or wildcard).
- Authorized JavaScript origin, if configured: `https://jl-bke.com`.
- The consumer must implement `/api/auth/google/callback` and derive its exact redirect URL from the validated canonical `APP_URL`, rather than untrusted request headers. This is an implementation contract, not a live route claim.
- Use only identity scopes needed for sign-in. Keep the client secret in protected deployment configuration; never in GitHub, browser code, Notion or review comments. The owner reports creating the OAuth client; redirect settings, audience access and actual provider acceptance remain unverified.

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

`HYPERDRIVE_FRESH` must reference a provider configuration with query caching
disabled before any staging/live acceptance. Its all-zero ID is an explicit
unprovisioned placeholder; the local connection string is only the disposable
Actions PostgreSQL service. Neither its binding name nor local tests prove
provider cache configuration. No resources are created or deployed by CI.

Workers receiving proof is a required job in the existing explicitly invoked
`ci.yml`, alongside its existing database/source, Node build, Docker and security
owners. No automatic PR/push workflow remains. Select the candidate branch's
workflow definition and exact source SHA: comment runs loading main's older
definition do not include the new job. The first bootstrap run generated npm
bytes; their artifact SHA-256 and lockfile provenance are recorded in PR266.
The ingested lockfile must be unchanged by verification. Sessions are fixtures
in disposable Actions PostgreSQL, not evidence of Google provider sign-in.

Beyond the verified receiving milestone, still required: raw-pg call-site audit,
provider cache-disable verification, real Google/Redis configuration and
sign-in, representative licensing/transaction receiving proof, bounded
scheduled entrypoint, deployed Free CPU/startup/bundle/memory evidence and
installed native interaction. Keep the parent PARTIAL until those gates
are resolved. No merge or deployment is authorized by this candidate.

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

Read-only account inspection found no Worker scripts, Hyperdrive configurations,
or workers.dev subdomain in the owner-selected jlprojectfreedom account.
The active `jl-bke.com` DNS zone is in the owner's other connected Cloudflare
account. This is an inventory finding, not authorization to transfer the zone,
change DNS or deploy. Select a test origin, establish the fresh PostgreSQL and
distributed one-time/rate-limit store, and configure the exact Google callback
before real sign-in testing.

Keep the OAuth client secret, Redis token, database credentials, session secret,
application-factor encryption key, licensing pepper and signing private key
in protected configuration only. The public client ID and origin may be recorded;
secret values must not appear in source, profiles, artifacts, comments or Notion.

The owner subsequently selected `https://try.jl-bke.com` for testing and confirmed
that the apex site is currently live on the VPS. Preserve the apex and its routing.
The exact test Google callback is
`https://try.jl-bke.com/api/auth/google/callback`; test runtime configuration must
use that origin. Infisical is the owner's existing secret manager. Its project,
test environment and delivery integration still require confirmation; no secret
values belong in this repository. See the Google consumer contract for delivery
and production-cutover boundaries.

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
