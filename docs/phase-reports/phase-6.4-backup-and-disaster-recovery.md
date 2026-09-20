# Phase 6.4 — Backup & Disaster Recovery

Status: implemented in the uncommitted working tree; owner review required.

## Delivered

- Migration 21 adds durable archive and operation history.
- A dedicated worker performs compressed PostgreSQL and private-object backups outside web requests.
- AES-256-GCM encryption, canonical manifests, SHA-256 verification, missing-object detection, retention tiers, abandoned-work recovery, and isolated restore safeguards are implemented.
- The scheduler registers daily backup and retention jobs.
- `/admin/backups` provides create, dry-run, verify, restore simulation, isolated restore, history, and expired-archive deletion controls behind administrator MFA and recent authentication.
- Docker includes a least-privilege backup worker with PostgreSQL client tools and ephemeral scratch space.

Archives do not contain environment files, master keys, API secrets, cloud credentials, or Valkey cache. Provider configuration rows are included as application ciphertext; their master key remains external. Restore can target only separately configured isolated destinations after exact confirmation.

Unit and PostgreSQL integration coverage verifies manifests, checksums, authenticated-encryption corruption detection, missing-object detection, retention, idempotent requests, distributed-safe claims, abandoned-work recovery, and restore-request rollback. TypeScript and ESLint pass. Vitest passes 155 with 6 credential-gated skips; Playwright passes 11/11. The production build, migration 21 deployment/smoke in development and certification, Docker production image build, repository hygiene, and runtime dependency audit pass. The Docker build preceded the last small fail-fast/logging/metadata adjustments; an exact final image refresh is still required after the execution environment's external-operation quota resets.

The first genuine certification archive correctly stopped as `INCOMPLETE`: 5 of 12 database-referenced source objects were absent from certification MinIO. Seven present objects and the encrypted database were archived, but the framework refused to certify or restore the incomplete recovery point. This is valid missing-object detection, not a successful restore drill. The certification fixture/storage drift must be repaired before a genuine complete archive and restore simulation can pass.

## Remaining production risks

- Offsite provider selection, credential provisioning, and key escrow are owner operations.
- A production-sized restore drill is required before launch; no RTO is claimed yet.
- Database dumps and individual objects are currently buffered during cryptographic processing, and the production worker scratch volume is capped at 1 GiB. Streaming/multipart processing and measured capacity sizing are required before production datasets approach those limits.
- The host runtime audit reports zero vulnerabilities, but the completed Docker install emitted a high-severity advisory before the final dependency override. Rebuild and audit the exact final container image before approval.
- Final retention requires Phase 6.7 legal/privacy/tax approval.
- Phase 6.5 monitoring and alerting have not begun.
