# Background jobs

Every background behavior enters through the scheduler service. Handlers reuse existing storage cleanup, email outbox, webhook, product-deletion, and entitlement transactions.

Scheduled execution is durable and restart-safe. A worker synchronizes compiled definitions, recovers timed-out `RUNNING` rows as `ABANDONED`, runs due retries, then runs due definitions. Only one holder may execute a key at once. Repeated scheduled-window requests return the existing run instead of repeating work.

Dry runs query the same eligibility predicates but cannot change lifecycle state or send mail. Payment processing retries only failures classified as retryable. Reconciliation work creates review reminders and durable summaries; it never turns a local order into `PAID`. Customer lifecycle review calculates due work and alerts administrators but never purges data.

Real-time authorization remains authoritative. Expired licenses are denied by activation and download checks even if the scheduler is delayed; the job synchronizes stored status, creates exactly one transition event, and queues a deduplicated notification.
