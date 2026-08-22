# Production topology

This is the canonical engineering map of the BKE Digital Solutions production runtime. Keep it synchronized with `docker-compose.production.yml`, `Caddyfile`, deployment automation, migrations, and the detailed operations runbooks. It must not contain credentials or secret values.

## Runtime overview

```text
Internet
   |
   | HTTP :80 / HTTPS :443
   v
Caddy
   |
   |-- fixed Licensing Agent installer routes
   |      -> read-only host storage
   |         /opt/bkes/licensing-agent/
   |
   `-- reverse proxy
          |
          v
       Next.js app
          |
          |-- PostgreSQL
          |-- Valkey
          |-- MinIO
          `-- ClamAV

Scheduler ------> app + Valkey
Backup worker --> PostgreSQL + MinIO

Operational one-shot containers:
- migrate
- operations
```

`docker-compose.production.yml` defines the production topology. Caddy is the only service that publishes host network ports. Application and data services communicate through Compose networks.

## Services and responsibility

| Service | Responsibility | Persistent state | Network boundary |
| --- | --- | --- | --- |
| `caddy` | TLS termination, reverse proxy, fixed Licensing Agent binary delivery | `caddy_data`, `caddy_config` | public 80/443/443-udp; private + egress |
| `app` | Next.js application and HTTP API | no container-local durable state | private + egress |
| `scheduler` | scheduled application jobs | no container-local durable state | private |
| `backup-worker` | backup processing | no container-local durable state | private + egress |
| `postgres` | canonical relational application and licensing state | `postgres_data` | private only |
| `valkey` | cache/coordination with AOF persistence | `valkey_data` | private only |
| `minio` | object/artifact storage | `object_data` | private only |
| `minio-init` | idempotent MinIO initialization | none | private only; exits after completion |
| `clamav` | malware scanning | no application durable state | private only |
| `migrate` | explicit database migration operation | writes through PostgreSQL | operations profile; private only |
| `operations` | explicit operator CLI tasks such as grace control | writes through approved application/database interfaces | operations profile; private only |

The `private` network is `internal: true`. Services that need outbound connectivity additionally join `egress`.

## Durable-state boundary

Persistent production state includes:

- `postgres_data` — relational application and licensing state.
- `object_data` — MinIO object/artifact storage.
- `valkey_data` — Valkey persistence.
- `caddy_data` — Caddy runtime/TLS state.
- `caddy_config` — Caddy-managed configuration state.

Application, scheduler, backup-worker, migration, operations, and ClamAV containers are replaceable compute. Their container filesystems are not the canonical durable store.

Normal deployment must preserve the named volumes above. `docker compose down -v`, manual volume deletion, and host-storage deletion are not normal deployment operations.

## Public ingress

```text
Internet
   |
   +-- :80 --------+
   +-- :443 -------+--> Caddy
   +-- :443/udp ---+
                         |
                         +--> Next.js app:3000
                         `--> fixed Licensing Agent downloads
```

PostgreSQL, Valkey, MinIO, ClamAV, scheduler, backup-worker, migration, and operations do not publish public host ports in the production Compose topology.

## Licensing Agent distribution

The Licensing Agent is shared infrastructure, not a commercial Product. Detailed operations live in `docs/operations/licensing-agent-distribution.md`.

Canonical page:

```text
https://jl-bke.com/licensing-agent
```

Stable public installer paths:

```text
/licensing-agent/windows/download
/licensing-agent/macos/download
/licensing-agent/linux/download
```

Host storage:

```text
/opt/bkes/licensing-agent/
├── windows/BKELicensingAgentSetup.exe
├── macos/BKELicensingAgentSetup.pkg
└── linux/BKELicensingAgentSetup.deb
```

`LICENSING_AGENT_STORAGE_PATH` may override the host-side source path. Only Caddy requires the installer host mount. The Next.js landing page renders the three permanent platform links and does not inspect installer storage.

Caddy mounts installer storage read-only and serves only the three explicitly mapped files. Installer artifacts are external to Git. After the one-time distribution deployment, atomic installer replacement requires no Git commit, application rebuild, database migration, application restart, or Caddy restart.

## Operational grace control

Air Stack and Render Dock operational grace is PostgreSQL-backed and changed only through the `operations` CLI/service. It is not an Admin UX and there is no public write API.

Public read endpoints:

```text
/api/graceperiod/airstack
/api/graceperiod/renderdock
```

Current production operator invocation:

```bash
cd /root/bke-digital-solutions

docker compose \
  --env-file .env.production \
  -f docker-compose.production.yml \
  --profile operations \
  run --rm \
  -e NODE_OPTIONS=--conditions=react-server \
  operations \
  npm run grace:set -- renderdock true
```

Change `renderdock` to `airstack` for Air Stack, and change `true` to `false` to revoke the override. Verify through the public read endpoint after every mutation:

```bash
curl -fsS https://jl-bke.com/api/graceperiod/renderdock
echo
```

The CLI write is audited. Missing state and read failures fail closed to `false`. The operational slugs `airstack` and `renderdock` are intentionally distinct from canonical licensing Product IDs `bke-air-stack` and `bke-render-dock`.

A grace mutation must not require an application rebuild or runtime restart. The `operations` image must already exist for a no-build routine invocation; pruning that image can force Compose to rebuild the one-shot operations image before the command runs.

## Security and filesystem boundaries

Production uses least-privilege controls where practical:

- application containers use read-only root filesystems;
- writable temporary space is explicit `tmpfs`;
- `no-new-privileges` is enabled;
- Linux capabilities are dropped and selectively restored only where required;
- process limits are explicit;
- Licensing Agent storage is read-only inside Caddy;
- no generic `/opt` file browsing or directory listing is exposed;
- Caddy admin API is disabled;
- sensitive PayMongo signature headers are removed from access logs.

Do not add public ports, writable host mounts, public file browsers, upload routes, or direct database/cache/object-store exposure without explicit architecture and security review.

## Deployment flow

Conceptually:

```text
GitHub canonical main
        |
        v
clean production checkout
        |
        +--> validate topology/configuration
        +--> build replaceable application images
        +--> run explicit database migrations
        +--> reconcile runtime services
        +--> verify live + ready health contracts
        `--> verify production behavior
```

Database schema changes are applied through the explicit migration service rather than by recreating PostgreSQL state. Licensing Agent installer replacement and grace mutation are routine operations separate from application deployment.

## Health and dependency model

Primary health contracts:

```text
/api/health/live
/api/health/ready
/api/health/scheduler
```

`app` waits on healthy PostgreSQL, Valkey, ClamAV, and successful MinIO initialization. `scheduler` waits on a healthy app and Valkey. Caddy depends on a healthy app. A container being `Up` alone is not proof that production is healthy.

## Backup and recovery boundary

Detailed backup and restore procedure belongs in the dedicated operations runbooks. Disaster recovery planning must account for PostgreSQL, MinIO/object state, required production environment configuration and secrets held outside Git, relevant Caddy/TLS state, and known-good Licensing Agent installer artifacts.

Never treat a Git checkout or Docker image as a backup of production data.

## Source-of-truth hierarchy

For engineering/runtime truth:

1. GitHub `main` and repository governance.
2. `docker-compose.production.yml`, `Caddyfile`, Dockerfile, scripts, and migrations.
3. This topology document and detailed repository operations runbooks.
4. Production verification evidence.

Notion and other planning systems may summarize and navigate this architecture, but GitHub remains the executable engineering source of truth.

## Change rule

Any change that materially alters service ownership, public ingress, persistent state, networks, host mounts, deployment sequencing, grace operations, or recovery boundaries must update this document in the same engineering change or explicitly explain why no topology documentation change is required.
