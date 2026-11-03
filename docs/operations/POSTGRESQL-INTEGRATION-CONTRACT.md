# PostgreSQL integration contract for V3 Workers

This contract is a handoff to the owner of the Cloudflare Workers composition (PR #266) and Google-only identity integration (PR #267). It intentionally defines seams without changing those PRs.

## Runtime inputs

- Node/Docker: existing `DATABASE_URL` for runtime; optional `DIRECT_DATABASE_URL` for direct migration/admin operations.
- Workers: use the request's `env.HYPERDRIVE` binding connection string for ordinary database access and a separate cache-disabled Hyperdrive binding for security-critical reads.
- Migration CLI: run only in a controlled Node/CI environment against a direct endpoint; never invoke Prisma migration deployment inside a user request.
- No D1, no SQL dialect translation, no live resource provisioning as part of this PR.

## Required implementation seam

Provide two equivalent factories behind a narrow interface that Sol can compose:

- `createNodeDatabaseClient(env)`: existing Prisma 7.9.1 + `@prisma/adapter-pg` / `pg`, bounded pool, direct/runtime URLs selected explicitly.
- `createWorkerDatabaseClient(env)`: use Hyperdrive-provided connection details and a supported Worker-compatible `pg`/Prisma adapter path. Construct within request scope, set a conservative per-request pool/connection bound, and always release it in `finally`.
- `createFreshAuthorizationDatabaseClient(env)`: use the cache-disabled Hyperdrive binding. This client is mandatory for session status/revocation, MFA and recent-auth, account membership/permissions, Claim Code consumption/status, payment finalization and entitlement/licensing authorization.
- All clients expose the same PostgreSQL semantics and domain operations; no route should branch on provider-specific SQL behavior.

Do not create a global reusable Worker client or rely on session affinity. Hyperdrive transaction pooling may reset session state between transactions. Keep multi-step atomic work inside the existing transaction callback and preserve its isolation/locking options.

## Mandatory behavior gates

1. **Atomicity:** a forced exception after each write in a multi-row commerce/Claim Code flow must roll back every related row.
2. **Concurrency:** parallel payment webhook replay, Claim Code redemption, and entitlement issuance must yield exactly one legal winner and no duplicate entitlement.
3. **Isolation:** operations currently requiring serializable isolation retain it; exercise serialization failures and the existing bounded retry policy.
4. **Row locks:** worker/job claiming using `FOR UPDATE SKIP LOCKED` does not double-claim a row; locks release on commit and rollback.
5. **Fresh authorization:** revoke a session or remove membership in one client; the next authorization decision through the cache-disabled binding must deny. Do not rely on Hyperdrive cache comments or assumed write invalidation.
6. **Lifecycle:** concurrent requests do not share a client/transaction; request completion releases resources; connection refusal, timeout, auth failure, server restart, exhausted compute, and stale connection fail closed and return bounded errors.
7. **Migration:** replay every migration into an empty PostgreSQL database and upgrade a copy of the baseline schema. Preserve triggers, enums, indexes, foreign keys, generated SQL, and migration history.
8. **Restore:** restore a verified encrypted export to a distinct disposable target and compare integrity evidence before declaring success.

## Required evidence per run

Record the repository SHA, Node version, PostgreSQL major/minor, Prisma version, provider/region, driver/adapter versions, migration list/hash, exact test command, CI run URL, result counts, restore elapsed time, and any skipped tests. Redact all connection URLs and secrets. A mocked database, static typecheck, local wall-clock measurement, or successful build alone is not PostgreSQL/Workers acceptance.

## Ownership and migration sequencing

- Sol owns PR #266's Worker runtime/application composition and PR #267's Google OAuth implementation. Do not edit those branches or auth/session/MFA routes here.
- This PR owns provider-neutral documentation and isolated PostgreSQL compatibility test assets only. If a runtime factory change is required, stop at this interface and request/record the integration seam for Sol rather than racing those changes.
- `@bke/identity` 0.5.0 adoption is gated on the immutable package being released and its bytes verified. PR #267's Google identity migration remains downstream and must be replayed after the identity integration gate. Neither this contract nor a green disposable PostgreSQL test authorizes merge, deployment, resource creation, or production unlock.
