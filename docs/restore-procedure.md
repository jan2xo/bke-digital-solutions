# Restore Procedure

Provision a new empty PostgreSQL database and a new empty private object bucket. They must not equal the source database, application bucket, or backup bucket. Configure only the backup worker with `BACKUP_RESTORE_DATABASE_URL`, `BACKUP_RESTORE_S3_BUCKET`, and `BACKUP_RESTORE_ACK=ISOLATED_TARGET_ONLY`, plus separately retrieved backup credentials and encryption key.

The application validates that the restore database URL differs from `DATABASE_URL` and that the restore bucket differs from both source and backup buckets. A restore request also requires the exact phrase `RESTORE TO ISOLATED TARGET <backup-id>`.

1. In `/admin/backups`, verify the chosen archive.
2. Run **Simulate restore**. This authenticates and decrypts every archive object, recalculates plaintext hashes, and validates the database artifact without changing a target.
3. Configure isolated targets and enter the exact confirmation phrase.
4. The worker restores PostgreSQL and private objects to those isolated destinations.
5. Run migration status and post-migration smoke against the isolated database.
6. Compare manifest migrations, table counts, object count, and representative customer/order/invoice/license/legal/audit records.
7. Record measured duration and sign off the drill. Do not cut over automatically.

If any checksum, AES-GCM authentication, missing-object, target-isolation, or validation check fails, stop. Preserve the archive and operation record; do not weaken validation.
