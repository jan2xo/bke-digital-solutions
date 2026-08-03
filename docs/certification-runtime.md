# Certification runtime

The certification stack is the primary local production simulation. It composes `docker-compose.production.yml` with `docker-compose.certification.yml`, loads the ignored `.env.certification`, and uses the same application and migration image targets intended for production.

## Commands

```bash
npm run certification:check
npm run certification:compose -- config
npm run certification:compose -- up
npm run certification:compose -- refresh
npm run certification:compose -- migrate
npm run certification:compose -- seed
npm run certification:compose -- smoke
npm run certification:compose -- status
npm run certification:compose -- logs
npm run certification:test:all
npm run certification:test:e2e
npm run certification:compose -- down
```

`up` starts PostgreSQL, Valkey, and MinIO; initializes storage; applies migrations; runs the idempotent seed; then rebuilds and force-recreates the application and Caddy. `refresh` migrates first and then rebuilds and force-recreates the serving containers so an old application image cannot remain active. Readiness, not liveness alone, gates the application container.

Certification exposes PostgreSQL on `127.0.0.1:55432`, Valkey on `127.0.0.1:56379`, MinIO on `127.0.0.1:59000`, and Caddy on `127.0.0.1:8080`. These loopback bindings exist only in the certification override. The services retain the private internal network used by production and also join a certification-only bridge required for host tests.

The host test wrapper parses `.env.certification` without printing it, translates internal container endpoints to the loopback ports, forces mock payment and log email for ordinary suites, and removes real provider credentials from child environments. Use the dedicated credential-gated commands for genuine provider checks; never mix genuine provider credentials into the deterministic full regression suite.

## Failure interpretation

- `/api/health/live` proves the process is running.
- `/api/health/ready` returns 503 if PostgreSQL, Valkey, private storage, or selected provider configuration is unavailable.
- A stopped dependency must make readiness fail and restoring it must return readiness to 200.
- A browser redirect never establishes payment success; only a verified webhook can finalize commerce.
- Failed credential-gated tests are provider-certification failures. Skipped tests mean required credentials or captured sandbox evidence were not supplied to that dedicated suite.

Do not copy `.env.certification`, Cloudflare tunnel credentials, webhook bodies/signatures, provider secrets, database contents, or generated evidence into Git or retained command output.
