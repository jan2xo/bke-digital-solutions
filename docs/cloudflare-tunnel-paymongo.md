# Cloudflare Tunnel and PayMongo certification

Namecheap is the registrar; Cloudflare is authoritative DNS. The owner-managed named tunnel currently routes `jl-bke.com` to `http://localhost:8080`. The safe repository example is `cloudflared/config.example.yml`; never commit the real UUID, JSON credentials, token, `cert.pem`, or an owner home path.

The connector may send origin `Host: jl-bke.localhost` while preserving `X-Forwarded-Host: jl-bke.com`. Certification Caddy accepts both origin names and passes the public forwarded host upstream. It uses plain loopback HTTP: Cloudflare owns public TLS. `tls internal` caused redirect/origin conflicts and must not be used here. Production `Caddyfile` retains normal public ACME/TLS behavior.

## PayMongo test webhook

The implemented endpoint is:

```text
https://jl-bke.com/api/webhooks/payments
```

In PayMongo Test Mode, subscribe only to event forms normalized by the adapter:

- `payment.paid`
- `checkout_session.payment.paid`
- `payment.failed`
- `checkout_session.payment.failed`
- `payment.refunded`

After changing the ignored webhook secret, run `npm run certification:compose -- refresh`. Then run `npm run certification:test:paymongo`, complete a real sandbox checkout, confirm the genuine signed event in the database, replay identical bytes, and run reconciliation with a known local order. Unknown valid events are recorded and acknowledged; unsigned, malformed, stale, wrong-mode, wrong-amount, and wrong-currency events are rejected.

The official root domain is temporarily served by the owner's Mac. Future VPS deployment replaces this tunnel origin while preserving Resend DNS records. Disable the sandbox webhook when the certification session ends if it is no longer needed.
