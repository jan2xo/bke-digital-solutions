# Production Deployment

Deploy only an approved, checked-out commit. Source acquisition and deployment
are separate operations; this procedure never performs an implicit pull.

The canonical operator path is:

```bash
git pull --ff-only origin main
BKE_HEALTH_URL=https://<canonical-production-health-host> npm run deploy
```

The script requires the canonical runtime file `.env` and
`docker-compose.production.yml`. V3 does not use alternate production
environment filenames. Create `.env` from `.env.example`, keep it ignored,
and populate it from the owner secret store.

`BKE_HEALTH_URL` is required because this repository does not define a single
canonical production hostname. The script verifies that `.env` exists but
never reads or prints its values.

The script performs, in order:

1. Verify the working tree is clean and display the branch and exact commit.
2. Run `npm run ops:validate` as the read-only production preflight.
3. Validate the effective Compose configuration.
4. Build `app`, `scheduler`, `backup-worker`, and `migrate`.
5. Run the one-shot `migrate` service through the `operations` profile.
6. Start `app`, `scheduler`, `backup-worker`, and `caddy`; Compose dependency
   conditions govern PostgreSQL, Valkey, MinIO initialization, and ClamAV.
7. Show Compose service status.
8. Run `npm run ops:health -- <health-url>`, which verifies both live and ready
   contracts and all ready dependencies.

Every mandatory command fails the deployment immediately. The script prints only
non-secret status and the deployed Git SHA.

## Troubleshooting and recovery reference

Equivalent manual commands, for diagnosis or recovery only:

```bash
DEPLOYMENT_ENV_FILE=.env \
DEPLOYMENT_COMPOSE_FILE=docker-compose.production.yml \
npm run ops:validate

docker compose --env-file .env \
  -f docker-compose.production.yml config --quiet

docker compose --env-file .env \
  -f docker-compose.production.yml build app scheduler backup-worker migrate

docker compose --env-file .env \
  -f docker-compose.production.yml --profile operations run --rm migrate

docker compose --env-file .env \
  -f docker-compose.production.yml up -d app scheduler backup-worker caddy

docker compose --env-file .env \
  -f docker-compose.production.yml ps

npm run ops:health -- https://<canonical-production-health-host>
```

Review service logs without printing environment values. For self-hosted MinIO,
ensure `minio-init` completes before application readiness. Roll back only to
an approved schema-compatible commit; never delete persistent volumes during an
incident.

Any feature that changes production topology, migration requirements, service
dependencies, initialization, deployment ordering, readiness semantics, backup
requirements, or post-deployment verification must update this canonical
production deployment automation in the same change.
