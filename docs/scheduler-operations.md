# Scheduler operations

The production Compose topology includes a non-root, read-only `scheduler` container. It calls the internal application once per minute with `CRON_SECRET` in the authorization header. Never put that secret in a URL, evidence file, screenshot, or log.

Use `/admin/scheduler` to inspect health, backlog, cadence, next/last runs, failures, average duration, and recent safe summaries. Mutations require administrator role, MFA, recent authentication, same-origin validation, input validation, rate limiting, and audit history.

Operations commands:

```bash
npm run scheduler:run
npm run scheduler:run -- --job=email.outbox --dry-run
npm run certification:compose -- logs
```

Investigate `unhealthy` jobs, repeated lock conflicts, terminal outbox/cleanup failures, or missed renewal runs. Pause only the affected key, perform a dry run, correct the dependency or configuration, manually retry failed work, then resume. Do not edit run rows or forge idempotency keys.
