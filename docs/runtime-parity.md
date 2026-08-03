# Runtime parity

Phase 6.0 defines one application artifact and startup contract for development, local certification, and production Docker. Certification is the production image plus a local-only Compose override; it is not a separate application build.

## Runtime contract

| Concern | Development | Certification | Production |
| --- | --- | --- | --- |
| Application | local Next.js process | production `runner` image | production `runner` image |
| Database changes | Prisma development workflow | one-shot `migrations` image | one-shot `migrations` image |
| Seed | explicit command | one-shot `seed` image | explicit one-shot `seed` image |
| Readiness | database, Valkey, storage, provider configuration | same checks | same checks |
| Payments/email | mock and log by default | environment-selected | environment-selected |
| External ports | developer configuration | loopback-only test ports | Caddy only |

The application container runs as a non-root user, uses the Next.js standalone output, has a read-only root filesystem, drops Linux capabilities, and receives writable temporary filesystems only where required. Image references used by the application stack are digest-pinned. The Dockerfile uses build-only placeholder values; runtime credentials are injected only by Compose or the deployment secret store and are validated at startup.

## Environment audit

`lib/config/environment.ts` is authoritative for application runtime variables. Unknown operating-system and Node variables are not rejected globally because the process environment necessarily contains platform-owned values. Provider-specific structures are validated again at their boundary.

- Required in every running application: deployment identity and URLs, PostgreSQL, session/MFA/license/cron secrets, Valkey, private storage, provider selectors, email sender, and logging configuration.
- Optional: direct database URL, public webhook origin, trusted origins, Upstash REST credentials, provider database-fallback controls, monitoring and future backup settings.
- Development-only: mock payment, log email, local service endpoints, demo seeding when explicitly enabled.
- Certification-only: `LOCAL_PRODUCTION_SIMULATION=true`, ignored `.env.certification`, sandbox evidence paths/IDs, Resend sandbox recipient, and loopback test ports.
- Production-only operational variables: `APP_DOMAIN`, `ACME_EMAIL`, PostgreSQL bootstrap values, MinIO bootstrap values, and externally supplied production secrets.
- Script-only: administrator bootstrap inputs and acknowledgement. They are consumed by the script, not the web runtime.
- Deprecated: none intentionally supported. Remove obsolete deployment variables rather than silently aliasing them.

The committed `.env.production.example` is a documented template, not a runnable secret file. It must be copied to an ignored deployment environment and every placeholder replaced. Never run `docker compose config` in a retained log when real secrets are loaded because resolved Compose output can contain secret values; use `npm run certification:check` and the quiet validation wrapper.

## Database and generated-client parity

The schema is validated before deployment. Migrations are append-only and applied by `prisma migrate deploy` before the application is recreated. The generated Prisma client is committed and must be regenerated from the same schema; Phase 6.0 verified that regeneration produces no additional diff. The seed is idempotent and preserves publication timestamps. Certification additionally uploads a deterministic private installer fixture so browser download authorization exercises real S3-compatible storage.

## Provider parity

Payment and email providers use the same selectors and resolver in all runtimes. Ordinary automated tests force mock/log providers and remove external provider credentials from the child process. Credential-gated PayMongo and Resend certification remain separate commands. Readiness verifies that the selected provider configuration can be resolved, but intentionally does not call an external provider on every health request; lifecycle certification and provider-outage alerting belong to Phases 6.2 and 6.5.

## Verified Phase 6.0 baseline

- TypeScript and ESLint passed.
- Prisma validation, deterministic generation, 17-migration status, idempotent seed, and database smoke passed.
- Full Vitest passed: 28 files passed, 1 skipped; 116 tests passed, 6 credential-gated tests skipped.
- Full Playwright passed: 9 tests.
- Local and Docker production builds passed.
- Compose validation, corrected startup/refresh, readiness dependency outages, and certification health passed.
- Runtime dependency audit reported zero vulnerabilities.

These results establish runtime parity only. They do not certify the full PayMongo lifecycle, production backups, monitoring, VPS deployment, legal approval, or production readiness.
