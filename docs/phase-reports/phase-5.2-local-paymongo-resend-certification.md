# Phase 5.2 — Local PayMongo and Resend certification

Status: local implementation and automated verification passed on 2026-08-02. Genuine provider certification remains **blocked until test credentials, an owner-controlled recipient, a tunnel, and manual sandbox actions are supplied**. The phase is not provider-certified.

## Scope delivered

- Separate staging-grade local simulation variables for canonical browser, internal service, and public webhook origins.
- Test-only PayMongo enforcement in local simulation and runtime adapter safety.
- Production image behind local HTTPS Caddy; private PostgreSQL, Valkey, and MinIO; one-shot migration, seed, and smoke operations.
- Credential-gated PayMongo checkout/retrieval/real-payload verification/reconciliation tests and Resend verified-domain delivery test.
- Temporary Cloudflare Tunnel and owner acceptance procedures.

## Evidence separation

| Area | Current evidence |
| --- | --- |
| Local automated verification | TypeScript and ESLint passed. Vitest: 75 passed, 6 provider-gated skipped. Playwright: 6 passed. Production build and production Docker image build passed. Ten migrations, idempotent seed, database smoke, liveness/readiness, hygiene, and runtime audit passed. |
| Genuine PayMongo sandbox | Not passed unless test credentials and real sandbox event evidence are present. |
| Genuine Resend | Not passed unless credential-gated delivery executes against an owner recipient. |
| Tunnel-only | Public signed delivery and genuine event types require the temporary tunnel. |
| VPS-only | Public HTTPS, long-running scheduler, monitoring, backup/restore, and deployment rollback remain deferred. |

## Provider limitations

PayMongo subscriptions continue to use customer-authorized renewal checkout; unattended recurring charging is not claimed. Refund initiation is not exposed by the current provider abstraction/admin UI, so real refund certification may remain provider/application blocked even though signed refund settlement logic is locally tested.

## Production risks

No VPS or public HTTPS validation exists. PayMongo sandbox lifecycle, real webhook delivery, refund capability, and Resend delivery must be evidenced. Monitoring, backup/restore certification, malware scanning/code signing, and legal/tax compliance remain outside this phase.

## Failures and corrections

- The first certification environment generation attempt was blocked by the execution sandbox's local IPC policy; it succeeded with approved local execution.
- Initial Compose validation showed the profiled MinIO dependency was absent. Certification now explicitly enables the self-hosted-storage profile.
- The operations image initially generated Prisma without a build-only `DATABASE_URL`; the Docker stage now supplies one.
- The first running Caddy override appended production ports, exposing `0.0.0.0:80/443`. Compose `!override` now replaces ports and volumes; verified final bindings are only `127.0.0.1:8080/8443`.
- The first host Vitest run could not access PostgreSQL under filesystem/network sandboxing. The approved rerun passed all 75 runnable tests.
- The first Playwright attempt found port 3000 already occupied by the owner's existing local server. The supported `PLAYWRIGHT_REUSE_SERVER=true` rerun passed all six tests.

## Executed evidence

- Compose config validation: passed after correction.
- Production image build: passed; `npm ci` reported zero vulnerabilities and Next.js built 59 routes.
- Services: app/postgres/valkey/MinIO healthy; Caddy loopback only; readiness reported all dependencies up.
- Prisma: schema validate/generate passed, generated client had no tracked drift, all 10 migrations applied/up to date, seed reported three products, smoke passed.
- Repository: `git diff --check`, TypeScript, ESLint, production build, repository hygiene (305 tracked files), and `npm audit --omit=dev --audit-level=critical` passed; audit found zero vulnerabilities.
- Genuine PayMongo suite: 1 safety gate passed, 5 real cases skipped (no test credentials/payment/event/order evidence).
- Genuine Resend suite: 1 delivery case skipped (no credential/owner recipient in the test environment).
- Cloudflare tunnel: not run; `cloudflared` is not installed and no owner account/tunnel was authorized.

No migrations were added or changed by Phase 5.2. `.env.certification` and browser artifacts remain ignored. No commit was created.
