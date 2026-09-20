# Operational grace period

This is a temporary operational continuity override for products whose normal authorization path is the BKE Licensing Agent. Grace is an authorization bypass and may be operated only by trusted VPS operators.

## Supported products and behavior

The only supported keys are `airstack` and `renderdock`.

- `true`: the desktop app may bypass Agent authorization.
- `false`: the desktop app uses normal Agent authorization.
- Missing state and database read errors always resolve to `false`.

The public read-only endpoints remain:

```text
GET /api/graceperiod/airstack
GET /api/graceperiod/renderdock
```

They return only `{ "grace": true }` or `{ "grace": false }` and use `Cache-Control: no-store`.

## VPS commands

The `operations` Compose service uses the production application image, including Node dependencies and the generated Prisma client. Run these commands from the deployed repository directory. They reuse `.env.production`; output never prints that file or its secrets.

```bash
docker compose --env-file .env.production -f docker-compose.production.yml --profile operations run --rm operations npm run grace:status
docker compose --env-file .env.production -f docker-compose.production.yml --profile operations run --rm operations npm run grace:set -- airstack true
docker compose --env-file .env.production -f docker-compose.production.yml --profile operations run --rm operations npm run grace:set -- airstack false
docker compose --env-file .env.production -f docker-compose.production.yml --profile operations run --rm operations npm run grace:set -- renderdock true
docker compose --env-file .env.production -f docker-compose.production.yml --profile operations run --rm operations npm run grace:set -- renderdock false
```

Only exact lowercase `true` and `false` are accepted. Unknown products and malformed commands fail without changing state. Repeating a value is safe and idempotent. Each set operation records old value, new value, product, timestamp, and `VPS_CLI` source in the existing audit log without inventing a user actor.

Verify from a trusted operator environment:

```bash
curl -fsS https://jl-bke.com/api/graceperiod/airstack
curl -fsS https://jl-bke.com/api/graceperiod/renderdock
```

## Safety, persistence, and rollback

Both products default to `false`; no seed rows are required. State is stored in PostgreSQL, so it survives process restarts, app container recreation, and application rebuilds. After the one-time migration/application deployment, changing state requires no application rebuild or restart and takes effect on the next request.

For emergency rollback, set the affected product to `false` using the CLI. Do not expose the write operation through the public web application. There is no Admin UI, public write API, payment coupling, entitlement coupling, or licensing-lease coupling.
