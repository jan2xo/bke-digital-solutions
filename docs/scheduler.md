# Scheduler

Phase 6.3 uses one typed registry in `lib/scheduler/registry.ts`. A job defines a stable key, description, category, cadence, timeout, lock duration, maximum attempts, dry-run support, health threshold, audit policy, and handler. Arbitrary database-stored code is impossible: durable definitions may enable or pause only compiled registry keys. Abandoned uploads are processed only from explicit durable `StorageCleanupJob` records created when an upload rollback fails; inactivity alone never classifies a draft installer for deletion.

PostgreSQL stores operational state in `ScheduledJobDefinition` and `ScheduledJobRun`. The scheduled-window idempotency key prevents duplicate durable execution records. Valkey uses one TTL-bound ownership-token lock per job key; release is an atomic compare-and-delete. Domain transactions, unique email keys, webhook IDs, cleanup claims, and lifecycle transition predicates remain the final safety boundaries.

Triggers are the Docker worker, `POST /api/cron/scheduler`, `/admin/scheduler`, and `npm run scheduler:run`. Secrets stay in environment variables and authorization headers. Scheduler health is separate at `/api/health/scheduler`; application readiness does not fail because one non-critical job failed once.

## Registry

| Key | Cadence | Responsibility |
|---|---:|---|
| `storage.lifecycle` | 5 minutes | Cleanup retry/recovery, explicit abandoned-upload jobs, deletion finalization |
| `email.outbox` | 1 minute | Pending delivery, retry, terminal failure classification |
| `subscriptions.renewal-reminders` | 1 hour | Deduplicated customer-authorized renewal reminders |
| `entitlements.expiration` | 5 minutes | Subscription/license/trial/grace expiry, download grants, inactive-device review |
| `commerce.lifecycle` | 15 minutes | Abandoned orders/attempts and offer reservations |
| `customers.retention-review` | 1 day | Retention/privacy/legal-hold review; never purge |
| `security.expired-records` | 1 hour | Sessions, MFA challenges, verification/magic/reset tokens |
| `payments.operations` | 15 minutes | Retryable stored webhooks and reconciliation reminders only |

Renewal and payment jobs never charge, settle, refund, or extend access without the existing customer-authorized and signed-webhook flows.
