# Production Deployment

BKE Digital Solutions V3 is operated through the repository Bash launcher. Operators should not hand-type Docker Compose command chains for normal deployment work.

## Normal operator path

Run the interactive menu:

```bash
./bke.sh
```

Or run one explicit action:

```bash
./bke.sh deploy
./bke.sh update
./bke.sh status
./bke.sh logs
./bke.sh restart
./bke.sh health
```

The canonical runtime configuration is always `.env`. The first-time flow is:

```bash
./bke.sh setup
./bke.sh env
./bke.sh validate
./bke.sh deploy
```

`setup` copies `.env.example` to ignored `.env` only when `.env` does not already exist and sets mode 600. It never overwrites existing owner secrets.

## What deploy does

`./bke.sh deploy` delegates to the guarded production deployment script. It:

1. Requires the canonical `.env` and production Compose file.
2. Derives the health origin from `APP_URL` unless `BKE_HEALTH_URL` is explicitly supplied.
3. Refuses a dirty Git working tree.
4. Runs the read-only production preflight and Compose validation.
5. Builds app, scheduler, backup-worker, and migration images.
6. Runs the one-shot production migration.
7. Starts the runtime services.
8. Shows service status.
9. Runs deterministic live/readiness health verification.

## Updating

Use:

```bash
./bke.sh update
```

The update action refuses a dirty tree, performs `git fetch origin` and `git pull --ff-only origin main`, then runs the same guarded deployment path.

## Operational actions

Use `./bke.sh status` for service state, `./bke.sh logs [service]` for logs, `./bke.sh restart` to restart runtime services, and `./bke.sh stop` to stop the stack without deleting persistent volumes.

Use `./bke.sh doctor` to print the current Git identity, validate the V3 configuration, and show Compose status.

The operator does not expose destructive volume deletion, hard Git reset, force push, or `prisma migrate dev`.

Any feature that changes production topology, migration requirements, service dependencies, initialization, deployment ordering, readiness semantics, backup requirements, or post-deployment verification must update `scripts/v3-ops.sh` and the guarded deployment script in the same change.
