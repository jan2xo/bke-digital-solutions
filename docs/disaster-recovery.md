# Disaster Recovery

This phase provides recoverability, not high availability. Recovery requires a clean application release, the corresponding Prisma migrations, an encryption key held outside the backup, access to the offsite backup bucket, and isolated PostgreSQL and object-storage targets.

## Recovery decision

1. Declare an incident and freeze normal writes.
2. Preserve logs and evidence; do not delete the suspected source.
3. Select the newest verified archive before the incident.
4. Run `SIMULATE_RESTORE` and investigate any manifest, ciphertext, plaintext, or missing-object failure.
5. Restore only to isolated targets and validate migrations, table counts, critical commerce/license/legal records, and private objects.
6. Obtain incident-owner approval before any traffic cutover. Phase 6.4 never points production at the restored target automatically.

Provider credentials stored in PostgreSQL remain encrypted ciphertext. Their separate master key and all environment secrets must be restored through the secret-management process, not from the archive. Valkey is rebuilt as disposable runtime state.

Every create, verify, simulate, restore, and retention deletion request and outcome is audited. Failed or abandoned operations remain in PostgreSQL for investigation and bounded retry.
