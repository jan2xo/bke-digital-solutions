# Local operations runbook

The current operational target is local Docker+Caddy simulation. See `local-production-simulation.md` for startup/migration/seed/smoke/stop commands.

Credential-gated provider commands:

```bash
npm run test:paymongo
npm run test:resend
npm run payments:reconcile -- --order-id <local-order-id>
```

Authenticated cron handlers remain the interfaces for outbox processing, expiration, and renewal reminders. A production scheduler is intentionally not configured before VPS deployment. Use the configured `CRON_SECRET` in an authorization header, never in a URL or evidence log. Temporary Cloudflare tunnels must be stopped and their PayMongo webhook registrations disabled after each certification session.

