# Local certification operations

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

The authenticated cron routes process outbox, expirations, and renewal reminders. A durable production scheduler remains VPS-only. Never place `CRON_SECRET` in a URL, command argument, evidence file, or log.
# Provider credential operations

Use `/admin/providers` only after MFA and recent authentication. Follow [the rotation runbook](operations/provider-credential-rotation.md) to save, validate, enable, replace, revoke, or migrate provider credentials. Loss of the external master key requires provider-side revocation and newly issued credentials; there is no plaintext recovery endpoint.
