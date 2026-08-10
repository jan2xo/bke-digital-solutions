# Local certification operations

## VPS production deployment and reboot recovery

Use [vps-production-deployment.md](vps-production-deployment.md) for fresh Ubuntu/Hetzner bootstrap, firewall, Docker boot enablement, secrets, Cloudflare/Caddy, migrations, rollback, backups, and cold-reboot certification. Compose statically guarantees `unless-stopped` for all long-running services; Docker daemon boot and actual reboot recovery require owner evidence.

## Compliance review

Use `/admin/compliance` to review technical evidence and explicit pending states. Never mark a legal, privacy, tax, BIR, or regulatory item implemented without the responsible professional approval and an auditable evidence reference.

## Supply-chain operations

Run `npm run supplychain:sbom` and `npm run supplychain:provenance` in a controlled build environment. Preserve the generated files with the release evidence. Do not mark signatures verified without detached-signature verification, and do not mark malware status clean without an actual scanner result.

## Customer lifecycle and private-storage cleanup

Use `/admin/customers/[id]` only from a recent MFA-verified administrator session. Closure is the normal access-ending operation. Privacy review requires an explicitly reviewed retention-expiry date. Apply legal hold whenever a dispute, investigation, tax, fraud, payment, refund, or legal duty requires preservation. Pseudonymization is allowed only after review and never rewrites invoice/order snapshots or immutable legal acceptances. Final purge must remain exceptional and blocker-free.

Product deletion first returns `CLEANUP_PENDING`. The administrator then runs cleanup/finalization. `PENDING` and `RETRYING` jobs are safe to process repeatedly; stale `PROCESSING` jobs recover after 15 minutes; `FAILED` requires manual retry and investigation. Never delete database rows or bucket objects manually to bypass a failed job. Object keys are operational secrets and must not be copied into tickets or audit notes.

Useful read-only query (run through approved database tooling): group `StorageCleanupJob` by `status` and inspect `attempts`, `nextAttemptAt`, `lastErrorCode`, target type/id, and correlation ID. Do not export `objectKey`.

## Legal document operations

1. Keep a published current version for Terms, Privacy, EULA, Refund Policy, and Subscription Terms before enabling registration or checkout.
2. Draft and preview in `/admin/legal`. Publishing requires recent authentication and MFA; review the summary, effective date, variables, and reacceptance flag first.
3. Use reacceptance only when existing customers must affirm the new version. It does not revoke sessions; affected customers are redirected on their next login or protected portal navigation.
4. Restore a prior published version instead of editing published content. Only drafts may be physically deleted.
5. Inspect acceptance counts and recent history in the Legal Center. Never update or delete acceptance rows directly; PostgreSQL rejects both operations.
6. Before changing `BUSINESS_ADDRESS`, `APP_URL`, `SUPPORT_EMAIL`, or company identity, preserve the old values. Each acceptance snapshots rendered variables and the rendered-content hash.
7. After restore or incident recovery, run `npm run db:status`, verify legal triggers/current pointers, and confirm registration plus perpetual/subscription checkout fail closed if required publications are absent.

```bash
npm run certification:check
npm run certification:compose -- config
npm run certification:compose -- up
npm run certification:compose -- refresh
npm run certification:compose -- migrate
npm run certification:compose -- seed
npm run certification:compose -- smoke
npm run certification:compose -- status
npm run certification:compose -- logs
npm run certification:test:all
npm run certification:test:e2e
npm run certification:test:resend
npm run certification:test:paymongo
npm run certification:compose -- queue-email
npm run certification:outbox
npm run certification:compose -- admin
npm run certification:compose -- down
```

`up` and `refresh` apply migrations before rebuilding and force-recreating the serving application. Certification database, Valkey, and MinIO host ports bind to loopback only. See [certification-runtime.md](certification-runtime.md) before diagnosing runtime drift. Use the quiet configuration check; resolved Compose output may contain loaded secrets.

Local health:

```bash
curl --fail http://127.0.0.1:8080/api/health/live -H 'Host: jl-bke.com'
```

Public health:

```bash
curl --fail https://jl-bke.com/api/health/ready
```

The dedicated Docker `scheduler` service calls `POST /api/cron/scheduler` over `INTERNAL_APP_URL` once per minute. The endpoint dispatches only typed registry jobs. Legacy outbox, expiration, and renewal routes delegate into the same framework. Never place `CRON_SECRET` in a URL, command argument, evidence file, or log.

Use `/admin/scheduler` for health and history. MFA and recent authentication are required for run, dry-run, pause, resume, retry, and acknowledge actions. CLI operations may run all due work with `npm run scheduler:run` or one job with `npm run scheduler:run -- --job=email.outbox --dry-run`. A dry run must be reviewed before manually running destructive-adjacent cleanup work.

## Backup operations

Use `/admin/backups` for audited manual requests. `npm run backups:create -- --dry-run` validates queueing without creating an archive; `npm run backups:create` queues a real archive. The `backup-worker` must be running and `BACKUP_ENABLED=true`. Never print resolved Compose configuration because it contains backup credentials and the encryption key.

Investigate `FAILED`, `INCOMPLETE`, or `CORRUPT` archives before retrying. A restore drill must begin with verification and simulation, then target only the isolated database and bucket documented in [restore-procedure.md](restore-procedure.md). Retention deletion applies only to expired archive prefixes and remains a durable audited operation.
# Provider credential operations

Use `/admin/providers` only after MFA and recent authentication. Follow [the rotation runbook](operations/provider-credential-rotation.md) to save, validate, enable, replace, revoke, or migrate provider credentials. Loss of the external master key requires provider-side revocation and newly issued credentials; there is no plaintext recovery endpoint.
## Observability

Open `/admin/observability` for the consolidated platform state. Use `/api/health/metrics` for automation. A warning means an operational condition needs review; critical means a dependency, scheduler, payment pipeline, security signal, or recovery point needs immediate investigation. Acknowledge and resolve alerts only after the underlying condition is understood. External alert delivery is not yet enabled.

## Operations hardening

Before exposing a deployment, verify production security headers over HTTPS, secure SameSite cookies, provider credential key versions, and route-specific limits for authentication, checkout, webhooks, downloads, scheduler, backup, and observability. Keep containers non-root with read-only/no-new-privileges settings and use isolated restore targets. Never place secrets, raw webhook bodies, license keys, or signed download URLs in tickets or logs.

Configure versioned Ed25519 lease keys and trusted supply-chain verification keys only through protected environment configuration. Stable/LTS promotion must remain blocked until independently verified evidence exists.
### Certification lease signing

Protected environments fail closed unless `LICENSE_SIGNING_PRIVATE_KEY`,
`LICENSE_SIGNING_PUBLIC_KEY`, and `LICENSE_SIGNING_KEY_ID` are configured. Use
`npm run licensing:keys -- .certification-secrets` to create local certification
keys; never commit the private PEM or place it in a public secret store.
## Readiness note

Operational runbooks are implemented, but worker heartbeat certification,
production scanner/signing configuration, restore certification, and VPS
validation are still pending. Check `TRUTHCHECK.md` before declaring readiness.
## RM7 controls

`LICENSE_SIGNING_KEY_ID` identifies the commercial lease signer only.
`SUPPLY_CHAIN_SIGNING_KEY_ID` identifies the independent release-evidence signer.
Never reuse or cross-label these keys. `ALLOW_BREAK_GLASS=false` is the default;
break-glass may bypass governance separation only after an audited justification.
It never bypasses artifact, signature, malware, SBOM, provenance, migration, or
compliance evidence gates.
## Commercial signing-key rotation

Register a successor Ed25519 public key and external `env:` secret reference via
the administrator rotation endpoint. The endpoint validates the private/public
match and atomically retires the old key while activating the successor. Verify
`/api/licensing/keys` afterward. Never place private key material or references
in logs, tickets, or database exports.
