# Backup Strategy

Phase 6.4 protects the PostgreSQL system of record and every private object in the configured application bucket. A full database dump includes commerce, licensing, legal acceptance, customer, audit, scheduler, provider-configuration ciphertext, and backup metadata. It deliberately excludes Valkey cache, environment files, plaintext provider secrets, API credentials, cloud credentials, and encryption keys.

## Architecture

The scheduler queues a daily durable `BackupOperation`; it never performs the archive inline. A dedicated `backup-worker` claims work with `FOR UPDATE SKIP LOCKED`, recovers abandoned operations, and records retry state. PostgreSQL custom-format dumps are compressed, AES-256-GCM encrypted, and uploaded with private objects to a distinct backup bucket. A canonical manifest records migration names, safe table counts, object hashes, encrypted hashes, source-object gaps, retention tier, and safe runtime identifiers.

Production backup storage must use dedicated credentials, a bucket different from the source bucket, and a separately managed 32-byte encryption key. `BACKUP_OFFSITE_ACK=SEPARATE_FAILURE_DOMAIN` documents the operator's confirmation that backup storage is outside the application storage failure domain. The repository cannot independently prove a provider's physical failure domain.

## Schedules and recovery objectives

- Daily archives: retain 7 days by default.
- Weekly archives: retain 4 weeks by default.
- Monthly archives: retain 12 months by default.
- Manual archives: no automatic expiry.

These defaults are configuration, not a legal retention decision. Phase 6.7 must approve final tax, privacy, and legal retention. The target RPO is 24 hours after the daily scheduler is enabled. RTO is not yet asserted; it must be measured by repeated production-sized restore drills.

## Commands

`npm run backups:create -- --dry-run` creates a durable dry-run request. `npm run backups:create` queues a real archive. `npm run backups:worker` runs the worker. Administrators can use `/admin/backups` after password, email-code MFA, and recent authentication.

Never put `BACKUP_ENCRYPTION_KEY`, storage secrets, or restore credentials in source control, manifests, logs, or database metadata. Store the encryption key separately from the archive and include it in the offline recovery key ceremony.

## Capacity boundary

The Phase 6.4 worker uses encrypted temporary files for the database archive and processes source objects sequentially, but the current implementation still materializes each database dump and each individual object in memory during encryption or verification. The production Compose scratch volume is also capped at 1 GiB. Before production data approaches either boundary, replace the buffer-based encryption and verification path with streaming or multipart processing and size scratch storage from a measured production dump. A production-sized backup and restore drill is a launch gate, not an optional optimization.
