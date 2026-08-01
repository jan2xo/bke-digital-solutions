# Phase 5.2 — Local PayMongo and Resend certification

Status: local implementation, public tunnel routing, genuine Resend delivery, and real PayMongo test checkout creation passed on 2026-08-02. Genuine PayMongo payment/webhook/refund/reconciliation evidence remains open, so the phase is not fully provider-certified.

## Scope delivered

- Separate staging-grade local simulation variables for canonical browser, internal service, and public webhook origins.
- Test-only PayMongo enforcement in local simulation and runtime adapter safety.
- Production image behind loopback HTTP Caddy, with public HTTPS terminated by Cloudflare Tunnel; private PostgreSQL, Valkey, and MinIO; one-shot operations.
- Credential-gated PayMongo checkout/retrieval/real-payload verification/reconciliation tests and Resend verified-domain delivery test.
- Temporary Cloudflare Tunnel and owner acceptance procedures.

## Evidence separation

| Area | Current evidence |
| --- | --- |
| Local automated verification | TypeScript and ESLint passed. Vitest: 75 passed, 6 provider-gated skipped. Playwright: 6 passed. Production build and production Docker image build passed. Ten migrations, idempotent seed, database smoke, liveness/readiness, hygiene, and runtime audit passed. |
| Genuine PayMongo sandbox | Test credentials loaded and real hosted checkout creation passed. Payment retrieval, genuine webhook, refund, and reconciliation were skipped because their specific evidence IDs/files do not yet exist. |
| Genuine Resend | Direct delivery passed; public registration returned 201 with `emailSent:true`; one outbox message became `SENT` once. |
| Tunnel-only | Named tunnel is connected; public liveness/readiness now return the real application responses. Genuine PayMongo event delivery remains open. |
| VPS-only | VPS origin, long-running scheduler, monitoring, backup/restore, and deployment rollback remain deferred. |

## Provider limitations

PayMongo subscriptions continue to use customer-authorized renewal checkout; unattended recurring charging is not claimed. Refund initiation is not exposed by the current provider abstraction/admin UI, so real refund certification may remain provider/application blocked even though signed refund settlement logic is locally tested.

## Production risks

No VPS validation exists. PayMongo real payment/webhook delivery, refund capability, and reconciliation still require evidence. Monitoring, backup/restore certification, malware scanning/code signing, and legal/tax compliance remain outside this phase.

## Failures and corrections

- The first certification environment generation attempt was blocked by the execution sandbox's local IPC policy; it succeeded with approved local execution.
- Initial Compose validation showed the profiled MinIO dependency was absent. Certification now explicitly enables the self-hosted-storage profile.
- The operations image initially generated Prisma without a build-only `DATABASE_URL`; the Docker stage now supplies one.
- The first running Caddy override appended production ports. Compose replacement now leaves only `127.0.0.1:8080`; Cloudflare terminates HTTPS.
- The first host Vitest run could not access PostgreSQL under filesystem/network sandboxing. The approved rerun passed all 75 runnable tests.
- The first Playwright attempt found port 3000 already occupied by the owner's existing local server. The supported `PLAYWRIGHT_REUSE_SERVER=true` rerun passed all six tests.
- The owner initially used the wrong Compose base; the supported base is `docker-compose.production.yml` with the certification override and `self-hosted-storage` profile.
- Running provider tests in the slim app image failed because Vitest is intentionally absent. New host commands explicitly load `.env.certification`.
- The running app retained the old local `APP_URL` after the ignored file changed. Refreshing containers plus the corrected value now yields `https://jl-bke.com` at runtime.
- The tunnel set origin `Host: jl-bke.localhost` while preserving public `X-Forwarded-Host`. The certification-only Caddy listener now accepts both and forwards the public host; production Caddy was restored.
- Before that correction Cloudflare returned empty 200 responses and registration never reached PostgreSQL. After correction public health is real, registration created one unverified customer/token, and Resend accepted its verification email.
- The certification database initially contained zero users, explaining login 401. It is intentionally independent; customer registration and administrator bootstrap are separate owner actions.
- macOS initially resolved stale Namecheap parking DNS; the owner corrected local DNS before this audit.

## Executed evidence

- Compose config validation: passed after correction.
- Production image build: passed; `npm ci` reported zero vulnerabilities and Next.js built 59 routes.
- Services: app/postgres/valkey/MinIO healthy; Caddy loopback only; readiness reported all dependencies up.
- Prisma: schema validate/generate passed, generated client had no tracked drift, all 10 migrations applied/up to date, seed reported three products, smoke passed.
- Repository: `git diff --check`, TypeScript, ESLint, production build, repository hygiene (305 tracked files), and `npm audit --omit=dev --audit-level=critical` passed; audit found zero vulnerabilities.
- Genuine PayMongo suite: real hosted checkout plus safety gate passed; 4 payment/event/reconciliation cases skipped for missing transaction evidence.
- Genuine Resend suite: 1 genuine delivery test passed. Public registration returned 201 with `emailSent:true`, and the password-reset request returned 200.
- Email outbox: one owner-controlled message was queued and processed twice; final database state was one `SENT` row with one attempt.
- Cloudflare named tunnel: installed, connected, and verified through public liveness/readiness after the host-header correction.

No migrations were added or changed during this correction. `.env.certification` and browser artifacts remain ignored. Provider/local secrets exposed in an earlier conversation require owner rotation. No commit was created.
