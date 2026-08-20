# Production Deployment

Use the approved commit and `.env.vps`. Validate, build, migrate, then start
services in dependency order. The detailed existing procedure is
[vps-production-deployment.md](../vps-production-deployment.md).

Run the read-only preflight first:

```bash
npm run ops:validate -- .env.vps
```

It does not start or mutate services. A successful result reports Compose,
topology, and restart-policy checks. A failure means stop and correct the
configuration or approved commit before deployment.

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml config --quiet
docker compose --env-file .env.vps -f docker-compose.production.yml build app scheduler backup-worker migrate
docker compose --env-file .env.vps -f docker-compose.production.yml --profile operations run --rm migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app scheduler backup-worker caddy
docker compose --env-file .env.vps -f docker-compose.production.yml ps
curl --fail https://<production-host>/api/health/live
curl --fail https://<production-host>/api/health/ready
```

The deterministic post-deploy check is:

```bash
npm run ops:health -- https://<production-host>
```

Both health endpoints must return 2xx with a healthy/ok status. Any failure is
an operational stop condition; inspect service health/logs and do not publish.

For self-hosted MinIO, start `minio minio-init` before app. Review logs without
printing environment values. Roll back only to an approved schema-compatible
commit; never delete persistent volumes during an incident.

The scheduler healthcheck is semantic: it queries the private app scheduler
health route, which evaluates persisted job definitions, recent execution
windows, failures, and retry backlog. A healthy scheduler therefore means the
worker process is running and durable scheduler state is not stale. If it is
unhealthy, inspect scheduler/app logs and the `/api/health/scheduler` response;
do not replace the check with a process-only probe.

The backup worker intentionally has no fabricated HTTP healthcheck. Its
recovery contract is `restart: unless-stopped` plus durable `BackupOperation`
state and worker logs; verify those through the backup runbook after deploy.
