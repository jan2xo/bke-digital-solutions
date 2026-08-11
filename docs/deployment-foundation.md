# Deployment foundation

Phase 5.0 prepares BKE Digital Solutions for reproducible development, staging, and production deployment. It does not certify PayMongo, Resend, backups, monitoring, or launch readiness.

## Environment model

| Boundary | Development | Staging | Production |
| --- | --- | --- | --- |
| Runtime | local Node or Compose | production image | production image |
| Origin | one chosen `http://localhost:3000` origin | canonical HTTPS hostname | canonical HTTPS hostname |
| Data | disposable local data | isolated synthetic data | isolated customer data |
| Payments | mock, later PayMongo sandbox | mock until Phase 5.2, then sandbox | PayMongo only after certification |
| Email | redacted log transport | Resend using verified `jl-bke.com` sender | Resend using verified `jl-bke.com` sender after delivery certification |
| Storage | private MinIO bucket | isolated private bucket | isolated private bucket |

Each deployed environment needs a unique `DEPLOYMENT_ID`, database, Valkey namespace, S3 bucket, session secret, license pepper, cron secret, provider credentials, and administrator bootstrap process. Never copy production data into staging. `localhost` and `127.0.0.1` are distinct browser origins; choose one canonical `APP_URL` and use it for browser navigation, authentication links, payment returns, and webhook configuration.

## Host reboot recovery

The production Compose file sets `restart: unless-stopped` for app, scheduler, backup-worker, PostgreSQL, Valkey, MinIO (when enabled), and Caddy. The one-shot `migrate` service intentionally uses `restart: "no"` and is run explicitly during deployment. The VPS owner must enable Docker at boot (`sudo systemctl enable --now docker`) and verify after a full reboot with `docker compose ... ps` and health endpoints; repository configuration cannot prove host daemon boot behavior.

See the independent [VPS production deployment guide](vps-production-deployment.md) for exact commands and failure recovery.

## Configuration

Copy `.env.example` for local development. Copy `.env.production.example` to an ignored secret file for staging or production, replace every placeholder, and inject it through a secret manager where possible. Never commit that file. Validate before deployment:

```bash
npm ci
npm run config:validate
npm run db:generate
npx prisma validate
```

Staging and production require HTTPS, 48-character non-placeholder authentication secrets, distributed Valkey/Redis, private storage credentials, environment-specific bucket and key prefixes, and an operational support address. Production rejects mock payments and log-only email. `ALLOW_DESTRUCTIVE_ADMIN=false` is the default; enabling it is an exceptional owner decision requiring retention and backup approval.

`APP_URL` is the only canonical application origin. `TRUSTED_ORIGINS` is a comma-separated allowlist for exceptional same-origin deployments, not a wildcard CORS setting. `TRUST_PROXY_HOPS=1` matches the included single Caddy proxy. Change it only when the verified proxy chain changes. `DIRECT_DATABASE_URL` is optional and is used only by Prisma commands; the application uses `DATABASE_URL`.

## Container topology

`Dockerfile` builds a deterministic lockfile-based, multi-stage, Next.js standalone image. The runtime contains no test suite or browser dependencies, runs as UID 1001, uses a read-only root filesystem in Compose, writes only to `/tmp`, handles `SIGTERM` through Docker init, and exposes port 3000 only to the Compose networks.

`docker-compose.production.yml` contains:

- Caddy as the only public service on ports 80/443, with automatic HTTPS and persistent certificate data.
- The Next.js application on private and outbound networks.
- PostgreSQL and Valkey on the internal network only, with persistent volumes and health checks.
- Self-hosted MinIO is the selected production primary object store; its API and console are not published to the host.
- When enabled for production, MinIO is the primary private object store on the Docker `private` network (`http://minio:9000`) with persistent `object_data`; Cloudflare R2 is configured separately as the encrypted offsite backup destination. MinIO is never published to the host.
- Production Compose includes the one-shot `minio-init` service. It waits up to 60 seconds for MinIO administrative readiness, creates the application bucket privately, reconciles the dedicated `S3_ACCESS_KEY_ID` identity and bucket-scoped policy, and is a prerequisite of the app and backup worker. It is safe to rerun and never writes credentials to the repository. Root credentials are supplied only to MinIO and this initializer; application services receive only the filtered runtime environment.
- A one-shot `migrate` image behind the `operations` profile so replicas never race migrations.

### Production MinIO incident and remediation

The first VPS deployment exposed a bootstrap defect: a fresh self-hosted MinIO instance could be healthy while the configured application bucket and application identity were absent. The remediation adds the bounded, idempotent `minio-init` service described above. It creates the configured private bucket, reconciles a dedicated application identity, and applies only the bucket-scoped `bke-app-storage` policy. Root credentials are available only to `minio` and `minio-init`; app, scheduler, backup-worker, Caddy, PostgreSQL, and Valkey receive no root credentials.

The initializer verifies exact direct policy assignment and rejects identities with broader direct permissions or inherited/group permissions. Disposable runtime tests execute the actual initializer against MinIO and `mc` (clean bootstrap, idempotent rerun, broader-policy rejection, and group/inherited-authorization rejection). Final certification passed the MinIO suite 5/5 and certification Vitest 178 passed with 6 credential-gated skips; Playwright 11/11, TypeScript, ESLint, Prisma validation/generation, production build, Compose validation, hygiene, and `git diff --check` also passed. No production VPS was changed by this remediation.

Managed PostgreSQL, Valkey, and S3-compatible services can replace the bundled services by changing connection variables; the domain layer does not change. For Compose validation:

```bash
docker compose --env-file .env.production.example -f docker-compose.production.yml config --quiet
```

For a real deployment set `BKE_ENV_FILE` to the ignored runtime file and supply the Compose interpolation values with `--env-file`.

## Deployment workflow

1. Confirm the release commit and a clean generated Prisma diff.
2. Validate configuration and infrastructure reachability.
3. Take and verify a database backup before any destructive or non-backward-compatible migration.
4. Build the application and migration image once for the release.
5. Run exactly one migration job: `docker compose --profile operations run --rm migrate`.
6. Require a zero exit status, then run `npm run db:status` and `npm run db:smoke` from an authorized operations environment.
7. Start or roll the application replicas.
8. Check `/api/health/live`, then `/api/health/ready`, then a public catalog smoke path.
9. Observe error rate and dependency health before marking the release successful.

Use `prisma migrate deploy`, never `migrate dev`, in staging and production. Migration failure stops the release. Do not roll application code forward over a failed schema. Prefer a reviewed forward-fix migration. Restore the pre-migration backup only under the recovery runbook when a forward fix cannot preserve integrity. Historical commerce migrations must be additive or explicitly preserve snapshots.

## Health and proxy behavior

`GET /api/health/live` proves the process can answer HTTP and performs no dependency work. `GET /api/health/ready` checks PostgreSQL, Valkey, and the private object-storage bucket with bounded timeouts. It returns HTTP 503 when traffic should not be sent to the replica and never returns connection strings, secrets, customer data, or stack traces.

Caddy redirects HTTP to HTTPS automatically for a real hostname, forwards the external host/protocol and client address, supports streaming requests, and caps request bodies at 550 MB. Application upload validation remains authoritative through `MAX_ARTIFACT_BYTES`, which defaults to 250 MiB and cannot exceed 512 MiB. HSTS is emitted only when `DEPLOYMENT_ENV=production`; never run that setting on localhost.

## Storage, logs, monitoring, and backups

Buckets remain private. The application performs entitlement checks before one-time download grants and never returns permanent object URLs. Object keys must not contain personal data. Managed credentials should have bucket-scoped object permissions; MinIO root credentials are development/bootstrap credentials, not application credentials.

Operational logs are structured JSON through `operationalLog`, with timestamp, severity, environment, operation, safe correlation context, and redaction by sensitive key name. Do not log request bodies, provider payloads, checkout URLs, signatures, tokens, personal email addresses, or plaintext license keys. External log transport and alerting are Phase 5.5.

`BACKUP_BUCKET` and `BACKUP_RETENTION_DAYS` are integration metadata only. Phase 5.0 does not implement or certify backup jobs. Production requires encrypted database and object-storage backups, provider-independent retention, and a successful restore drill in Phase 5.6.

## Rollback and common failures

- Configuration validation failure: correct the named variable; never bypass validation.
- Readiness 503: keep the replica out of rotation and inspect only internal dependency logs.
- Migration failure: stop rollout, retain logs and backup, then forward-fix or invoke the approved restore procedure.
- Certificate failure: verify DNS, ports 80/443, ACME email, and persistent Caddy volumes.
- Login/CSRF failure: confirm the browser uses exactly `APP_URL`; do not mix localhost and 127.0.0.1.
- Storage readiness failure: verify private endpoint TLS, scoped credentials, bucket name, region, and path-style setting.
- Valkey failure: verify the environment-specific prefix and network/TLS URL; do not fall back to memory outside development/test.

The next gate is Phase 5.1 authentication and administrative security. PayMongo and Resend certification remain Phase 5.2 and Phase 5.3 respectively.
