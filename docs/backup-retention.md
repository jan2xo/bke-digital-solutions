# Backup Retention

Scheduled archives receive one UTC tier: monthly on the first day, weekly on Sunday, and daily otherwise. Defaults are 7 days, 4 weeks, and 12 months. Manual archives do not expire automatically.

Retention runs in two stages. The scheduler marks eligible archives `EXPIRED` and queues a durable `DELETE_EXPIRED` operation. The worker deletes only objects under that archive's unique prefix and marks it `DELETED`. Current or unexpired archives cannot be deleted by this action. Failures remain retryable and visible.

These are operational defaults. Phase 6.7 legal, privacy, tax, and BIR review must approve final retention. Preserve recovery archives needed for an active incident or legal hold through an explicit manual retention decision before expiry.
