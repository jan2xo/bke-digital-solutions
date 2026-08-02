# Local certification operations

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
npm run certification:test:resend
npm run certification:test:paymongo
npm run certification:compose -- queue-email
npm run certification:outbox
npm run certification:compose -- admin
npm run certification:compose -- down
```

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
