# Storage cleanup jobs

`StorageCleanupJob` durably records product deletion, artifact replacement/removal, abandoned upload, and orphan cleanup. The object reference is stored only in PostgreSQL; audit and security metadata use job/target IDs and bounded error codes.

States are `PENDING`, `PROCESSING`, `RETRYING`, `SUCCEEDED`, `FAILED`, and `CANCELLED`. A SHA-256 idempotency key prevents duplicate work. A conditional update claims one worker; concurrent workers cannot both delete. Errors are converted to a 16-character code, never raw provider text. Retry uses bounded exponential backoff, five automatic attempts, and manual retry. `PROCESSING` older than 15 minutes becomes `RETRYING`.

Phase 6.1 provides the durable claim protocol and manual/admin processing. Phase 6.3 schedules due jobs through `storage.lifecycle` without changing that protocol, recovers abandoned processing claims, processes explicit abandoned-upload cleanup records, and finalizes deletion only after every related cleanup succeeds. An inactive draft artifact is never inferred to be abandoned. Operators must investigate `FAILED`; the scheduler never finalizes a product with pending or failed jobs.
