# Job retry policy

Failures are classified as transient, permanent, configuration, dependency unavailable, validation, or concurrency conflict. Validation/configuration failures are terminal. Retryable failures use exponential delay beginning at 30 seconds, bounded jitter, a six-hour cap, and the job-specific maximum attempt count.

Each retry is a new durable run linked by `parentRunId`; the prior run remains evidence. An administrator may retry `FAILED`, `ABANDONED`, or `RETRYING` work after investigating it. Lock conflicts produce `SKIPPED` history and an audit event rather than running concurrently. Error storage is a bounded safe code, not an exception stack, secret, provider payload, object credential, email body, or license key.

Outbox records have their own five-attempt boundary and become `PERMANENTLY_FAILED`. Storage cleanup retains its existing object-level claim, five-attempt boundary, and hashed failure codes. Scheduler retries do not weaken either domain boundary.
