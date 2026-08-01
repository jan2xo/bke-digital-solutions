# Local certification operations

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
