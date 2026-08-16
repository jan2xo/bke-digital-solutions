# Production Deployment

Use the approved commit and `.env.vps`. Validate, build, migrate, then start
services in dependency order. The detailed existing procedure is
[vps-production-deployment.md](../vps-production-deployment.md).

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml config --quiet
docker compose --env-file .env.vps -f docker-compose.production.yml build app scheduler backup-worker migrate
docker compose --env-file .env.vps -f docker-compose.production.yml --profile operations run --rm migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app scheduler backup-worker caddy
docker compose --env-file .env.vps -f docker-compose.production.yml ps
curl --fail https://<production-host>/api/health/live
curl --fail https://<production-host>/api/health/ready
```

For self-hosted MinIO, start `minio minio-init` before app. Review logs without
printing environment values. Roll back only to an approved schema-compatible
commit; never delete persistent volumes during an incident.
