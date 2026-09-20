# Local Agent activation demo

This procedure is TEST/LOCAL ONLY. It must never use `.env.production`, VPS
resources, production signing keys, or real customer records.

## Terminal 1: Digital Solutions

```bash
cp .env.agent-demo.example .env.agent-demo
# Populate only local test Ed25519 keys in .env.agent-demo.
docker compose -f docker-compose.yml up -d postgres valkey minio
docker compose exec -T postgres pg_isready -U bke
npx prisma migrate deploy
node --env-file=.env.agent-demo ./node_modules/tsx/dist/cli.mjs scripts/seed-agent-demo.ts
node --env-file=.env.agent-demo ./node_modules/next/dist/bin/next dev -p 3000
```

The seeder is idempotent and prints only TEST fixture identifiers and the TEST
license key. The real activation route requires the seeded version to be
`STABLE`.

## Terminal 2: Agent

Start the Agent's loopback authorization service with its API base URL set to
`http://127.0.0.1:3000` and the matching local public key. The service must bind
only to `127.0.0.1`.

## Terminal 3: sample product

```bash
python samples/bke-local-product/sample_product.py \
  --agent-url http://127.0.0.1:<agent-port> \
  --product-id bke-agent-integration-test-product \
  --version 1.0.0 \
  --installation-id <local-installation-id>
```

Before activation this must return `DENY`. Activate the printed TEST license
through the Agent, then repeat the sample command and expect `ALLOW`.

The Agent integration test remains the authoritative automated proof until a
local Agent launcher is added; no production or VPS endpoint is involved.

## Reset

Stop the local processes, remove only the disposable `bke_agent_demo` database
and Agent SQLite file, then recreate them using this procedure. Never run the
reset against a production `DATABASE_URL`.
