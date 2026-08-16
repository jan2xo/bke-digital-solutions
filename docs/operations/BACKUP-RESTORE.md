# Backup and Restore

Archives in `BACKUP_BUCKET` contain an encrypted PostgreSQL custom dump,
encrypted private objects, a checksummed manifest, migration inventory, and
safe table counts. `BACKUP_ENCRYPTION_KEY` is separate recovery material.

From `/admin/backups`, run VERIFY then SIMULATE_RESTORE. For an isolated drill,
configure `BACKUP_RESTORE_DATABASE_URL`, `BACKUP_RESTORE_S3_BUCKET`, and
`BACKUP_RESTORE_ACK=ISOLATED_TARGET_ONLY` only for the backup worker. Targets
must be empty and differ from source and backup destinations. Run
RESTORE_ISOLATED, compare migrations/counts/records/object counts, and verify
evidence-object hashes. Stop on checksum, authentication, missing-object, or
isolation errors; never restore over production automatically.

Queue commands are `npm run backups:create -- --dry-run`,
`npm run backups:create`, and `npm run backups:worker`.
