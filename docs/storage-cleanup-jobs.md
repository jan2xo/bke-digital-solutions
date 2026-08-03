# Storage cleanup jobs

`StorageCleanupJob` durably records product deletion, artifact replacement/removal, abandoned upload, and orphan cleanup. The object reference is stored only in PostgreSQL; audit and security metadata use job/target IDs and bounded error codes.

States are `PENDING`, `PROCESSING`, `RETRYING`, `SUCCEEDED`, `FAILED`, and `CANCELLED`. A SHA-256 idempotency key prevents duplicate work. A conditional update claims one worker; concurrent workers cannot both delete. Errors are converted to a 16-character code, never raw provider text. Retry uses bounded exponential backoff, five automatic attempts, and manual retry. `PROCESSING` older than 15 minutes becomes `RETRYING`.

Phase 6.1 provides manual/admin processing. Phase 6.3 may schedule due jobs without changing the claim protocol. Operators must investigate `FAILED`; never finalize a product with pending/failed jobs.
