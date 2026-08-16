# BKE Digital Solutions Operator Cookbook

Master entry point for operating a fresh deployment without conversation
history. Never place secret values in Git, tickets, shell history, logs, or
copied command output.

## Navigation

- Fresh VPS: [FRESH-VPS-BOOTSTRAP.md](FRESH-VPS-BOOTSTRAP.md)
- Deployment: [PRODUCTION-DEPLOYMENT.md](PRODUCTION-DEPLOYMENT.md) and [vps-production-deployment.md](../vps-production-deployment.md)
- Disaster recovery: [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md) and [BACKUP-RESTORE.md](BACKUP-RESTORE.md)
- Release shipping: [RELEASE-SHIPPING.md](RELEASE-SHIPPING.md)
- Signing keys: [SIGNING-KEY-RECOVERY.md](SIGNING-KEY-RECOVERY.md)
- Troubleshooting and incidents: [TROUBLESHOOTING.md](TROUBLESHOOTING.md) and [incident response](../runbooks/incident-response.md)
- Provider credentials: [provider-credential-rotation.md](provider-credential-rotation.md)

These runbooks cover environment/secrets restoration, PostgreSQL, MinIO,
backup verification, Caddy/HTTPS, ClamAV, evidence restoration, rollback,
health checks, and the Licensing Agent boundary. DNS, PayMongo, Resend, VPS
access, and signing-key custody remain owner/provider actions.

## Emergency checklist

**New empty VPS:** follow FRESH-VPS-BOOTSTRAP, then PRODUCTION-DEPLOYMENT; stop
on any health or migration failure.

The read-only preflight is `npm run ops:validate -- .env.vps`; it validates the
merged Compose configuration, topology, and restart policies without starting
or changing services. After deployment, run
`npm run ops:health -- https://production-host`.

**Ship a release:** follow RELEASE-SHIPPING; never bypass readiness.

**Generate release evidence:** run `npm run supplychain:evidence -- <release-version>`
and follow RELEASE-SHIPPING for authenticated ingestion; the command only
creates local evidence files and never approves or signs a release.
For the historical expanded production-certification sequence, see the
[manual/diagnostic equivalent](RELEASE-SHIPPING.md#manual--diagnostic-equivalent);
it is not the default operator path.

**Restore:** follow DISASTER-RECOVERY and BACKUP-RESTORE using an isolated target.

**Backup verification:** use the authenticated `/admin/backups` VERIFY and
SIMULATE_RESTORE workflow; `npm run backups:create -- --dry-run` is the safe
queue preflight. RESTORE_ISOLATED is an explicit owner-authorized mutation.

**Release blocked:** inspect current payload hash and malware, SBOM, provenance,
dependency, backup, compliance, migration, signature, and approval evidence.

**Licensing service down:** verify Agent endpoint, installation identity,
lease-key configuration, and TLS/network path; never bypass Agent verification.
