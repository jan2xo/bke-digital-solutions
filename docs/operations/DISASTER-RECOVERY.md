# Disaster Recovery

Recovery order: new VPS → Docker/Git → approved commit → environment and secret
restoration → PostgreSQL and private object storage → signing-key/public-key
history → migrations → app services → evidence verification → health and
private-download checks. Keep source and backup targets distinct until sign-off.

Do not regenerate commercial/supply-chain signing keys, backup encryption keys,
session/MFA encryption keys, peppers, or provider encryption keys when historical
identity must be preserved. Restore them from owner custody. Evidence documents
are durable private objects validated against restored database references and
SHA-256 metadata. Follow [BACKUP-RESTORE.md](BACKUP-RESTORE.md), then run
`npm run db:status`, `npm run db:smoke`, and both health endpoints.
