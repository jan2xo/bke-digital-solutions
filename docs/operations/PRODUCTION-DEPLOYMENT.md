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
