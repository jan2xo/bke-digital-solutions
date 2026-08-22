# Production topology

This document is the canonical engineering map of the BKE Digital Solutions production runtime. Keep it synchronized with `docker-compose.production.yml`, `Caddyfile`, deployment automation, and operations runbooks. It describes topology and ownership boundaries; it must not contain credentials or secret values.

## Runtime overview

```text
Internet
   |
   | HTTPS :443 / HTTP :80
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

Production is defined by `docker-compose.production.yml`. Caddy is the only service that publishes host network ports. Application and data services communicate through Compose networks.

## Services and responsibility

| Service | Responsibility | Persistent state | Network boundary |
| --- | --- | --- | --- |
| `caddy` | TLS termination, public reverse proxy, fixed Licensing Agent binary delivery | `caddy_data`, `caddy_config` | Public `80`, `443`, `443/udp`; private + egress networks |
| `app` | Next.js application and HTTP API | No container-local durable state | private + egress |
| `scheduler` | Scheduled application jobs | No container-local durable state | private |
| `backup-worker` | Backup processing | No container-local durable state | private + egress |
| `postgres` | Canonical relational application state | `postgres_data` | private only |
| `valkey` | Cache/coordination state with AOF persistence | `valkey_data` | private only |
| `minio` | Object/artifact storage | `object_data` | private only |
| `minio-init` | Idempotent MinIO initialization | None | private only; exits after completion |
| `clamav` | Malware scanning | No application durable state | private only |
| `migrate` | Explicit database migration operation | Writes through PostgreSQL | operations profile; private only |
| `operations` | Explicit operator CLI tasks such as grace control | Writes only through approved application/database interfaces | operations profile; private only |

The `private` network is marked `internal: true`. Services that require outbound connectivity additionally join the `egress` network.

## Durable-state boundary

The following Docker volumes are persistent production state and must not be casually deleted during rebuilds or deployments:

- `postgres_data` — relational application and licensing state.
- `object_data` — MinIO object/artifact storage.
- `valkey_data` — Valkey persistence.
- `caddy_data` — Caddy runtime/TLS state.
- `caddy_config` — Caddy configuration state managed by Caddy.

Application, scheduler, backup-worker, migration, operations, and ClamAV containers are replaceable runtime compute. Their container filesystems are not the canonical durable store.

A normal application rebuild or `docker compose up -d` must preserve the named volumes above. Destructive volume operations such as `docker compose down -v`, manual volume deletion, or host-storage deletion are not normal deployment steps.

## Public ingress

Caddy is the public ingress boundary:

```text
Internet
   |
   +-- :80 --------+
   +-- :443 -------+--> Caddy
   +-- :443/udp ---+
                         |
                         +--> Next.js app:3000
                         |
                         +--> fixed Licensing Agent downloads
```

No PostgreSQL, Valkey, MinIO, ClamAV, scheduler, backup-worker, migration, or operations port is published directly to the host by the production Compose topology.

Caddy forwards normal web traffic to `app:3000` and supplies the expected forwarded host/protocol/client-IP headers.

## Licensing Agent distribution

The Licensing Agent is shared infrastructure, not a commercial Product. Its detailed runbook is `docs/operations/licensing-agent-distribution.md`.

Canonical customer page:

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

`LICENSING_AGENT_STORAGE_PATH` may override the host-side source path; the container-side path remains `/opt/bkes/licensing-agent`.

The directory is mounted read-only into both `app` and `caddy`:

- `app` observes whether each fixed installer exists so the dynamic landing page can expose accurate availability.
- `caddy` serves only the three explicitly mapped installer paths.

Installer files are external deployment artifacts and are never committed to this repository. Routine atomic replacement of a current installer requires no Git commit, application rebuild, database migration, application restart, or Caddy restart.

## Security and filesystem boundaries

Production services use a least-privilege baseline where practical:

- application containers use read-only root filesystems;
- writable temporary space is explicit `tmpfs`;
- `no-new-privileges` is enabled;
- Linux capabilities are dropped and selectively restored only where required;
- process limits are explicit;
- installer storage is read-only inside application/Caddy containers;
- the Licensing Agent distribution exposes fixed files, not arbitrary `/opt` browsing;
- Caddy admin API is disabled;
- sensitive PayMongo signature headers are removed from access logs.

Do not introduce a new public port, writable host mount, public file browser, upload path, or direct database/cache/object-store exposure without an explicit architecture and security review.

## Deployment flow

The repository's deployment runbook and scripts are authoritative for command-level procedure. Conceptually, production deployment is:

```text
GitHub canonical main
        |
        v
clean production checkout
        |
        +--> validate topology/configuration
        +--> build replaceable application images
        +--> run explicit database migrations
        +--> start/reconcile runtime services
        +--> verify live + ready health contracts
        `--> verify production behavior
```

A deployment must not replace or destroy persistent named volumes. Database schema changes are applied through the explicit migration service rather than by recreating PostgreSQL state.

The Licensing Agent installer replacement workflow is intentionally separate from application deployment after its one-time distribution topology has been installed.

## Health and dependency model

The application exposes separate liveness and readiness contracts:

```text
/api/health/live
/api/health/ready
```

The scheduler has its own health contract:

```text
/api/health/scheduler
```

`app` waits on healthy PostgreSQL, Valkey, ClamAV, and successful MinIO initialization. `scheduler` waits on a healthy app and Valkey. Caddy waits on a healthy app before normal startup reconciliation.

A container being `Up` is not by itself proof that production is healthy; use the repository health verification tooling and HTTPS production endpoints.

## Operational grace control

Air Stack and Render Dock operational grace is stored in PostgreSQL and changed only through the approved operations CLI/service. It is not an Admin UX or public write API.

Public read endpoints remain:

```text
/api/graceperiod/airstack
/api/graceperiod/renderdock
```

The operational slugs are intentionally distinct from canonical licensing Product IDs (`bke-air-stack`, `bke-render-dock`). Do not couple grace routing to commercial product identity without an explicit migration design.

## Backup and recovery boundary

Backups and restore procedures are documented separately in the operations runbooks. This topology document does not redefine retention, restore certification, or offsite policy.

At minimum, disaster recovery planning must account for:

- PostgreSQL durable state;
- MinIO/object durable state;
- required production environment configuration and secrets held outside Git;
- Caddy/TLS state where appropriate;
- external Licensing Agent installer artifacts or the ability to restore known-good installers.

Never treat a Git checkout or Docker image as a backup of production data.

## Source-of-truth hierarchy

For engineering/runtime truth:

1. GitHub `main` and repository governance.
2. `docker-compose.production.yml`, `Caddyfile`, Dockerfile, scripts, and migrations.
3. This topology document and detailed repository operations runbooks.
4. Production verification evidence.

External planning/documentation systems may summarize this architecture, but should link back here instead of becoming a conflicting executable source of truth.

## Change rule

Any change that materially alters production service ownership, public ingress, persistent state, networks, host mounts, deployment sequencing, or recovery boundaries must update this document in the same engineering change or explicitly explain why no topology documentation change is required.
