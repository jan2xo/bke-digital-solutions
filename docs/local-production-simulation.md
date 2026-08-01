# Local production simulation

This is the primary pre-VPS environment. It runs the production Next.js image behind local HTTPS Caddy with private PostgreSQL, Valkey, and MinIO networks. Only Caddy binds host ports (`127.0.0.1:8080` and `127.0.0.1:8443`).

## Prepare

```bash
npm run certification:env
```

The command creates ignored `.env.certification` with mode `0600`, generated local secrets, mock payments, and log email. To certify providers, edit that ignored file locally: select `paymongo`/`resend`, add test credentials and an owner-controlled recipient, and keep `PAYMONGO_LIVEMODE=false`. Never copy values into documentation or evidence.

## Validate and start

```bash
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml config --quiet
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml build
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml up -d postgres valkey minio minio-init
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml --profile operations run --rm migrate
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml --profile operations run --rm seed
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml up -d app caddy
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml --profile operations run --rm smoke
curl --fail --insecure https://jl-bke.localhost:8443/api/health/live
curl --fail --insecure https://jl-bke.localhost:8443/api/health/ready
```

`.localhost` resolves locally without a hosts-file edit on supported systems. Caddy uses an internal certificate, so either trust Caddy's local root certificate or use `--insecure` only for this local health check. Do not weaken application cookies or CSRF controls.

## Stop

```bash
docker compose -p bke-certification --profile self-hosted-storage --env-file .env.certification -f docker-compose.production.yml -f docker-compose.certification.yml down
```

Do not add `-v` unless intentionally deleting certification database, object, and Caddy state.

## Operations

Run migrations with the one-shot `migrate` service, not `prisma migrate dev`. The `seed` is designed to be idempotent. The `smoke` service checks the migrated database. PostgreSQL, Valkey, and MinIO have no host port in this topology.
