# Infrastructure baseline — August 2026

This document is the current source of truth for infrastructure and deployment planning.

## Public domain and DNS

- Official public domain: `jl-bke.com`
- Registrar: Namecheap
- Authoritative DNS provider: Cloudflare
- Namecheap DNS must not be treated as authoritative.

The canonical production origin is configured through `APP_URL`; application code must not hardcode a hostname. The production value is `https://jl-bke.com`. Possible future service names include `app`, `api`, `downloads`, `licenses`, `support`, and `status` under `jl-bke.com`, but none should be assumed until separately configured.

## Transactional email

Resend is the production transactional email provider and `jl-bke.com` is its verified sending domain. Production sender identities should use role addresses such as `noreply@jl-bke.com`, `licenses@jl-bke.com`, `billing@jl-bke.com`, `support@jl-bke.com`, and `security@jl-bke.com`.

Domain verification does not replace credential-gated delivery, bounce, complaint, suppression, and retry testing. API credentials remain deployment secrets and must never be committed.

## Deployment status

No VPS deployment has occurred. Domain acquisition, Cloudflare configuration, Resend domain verification, Docker deployment configuration, Caddy configuration, PostgreSQL, Valkey, MinIO, MFA, licensing, and commerce are available. Development and verification continue locally with Docker and localhost.

Target production request path:

```text
Internet -> Cloudflare -> VPS -> Caddy -> Next.js
                                          |-> PostgreSQL
                                          |-> Valkey
                                          `-> private MinIO/S3-compatible storage
```

Infrastructure remains environment-driven. VPS presence, service subdomains, public storage endpoints, and host-specific paths must not be assumed by application code.

## Remaining production milestones

- provision and harden the VPS;
- validate public HTTPS, Cloudflare proxy behavior, trusted proxy configuration, and security headers;
- complete PayMongo sandbox and eventual live certification;
- complete credential-gated Resend delivery and operational-event certification;
- configure monitoring and alerting;
- implement encrypted backups and execute restore drills;
- implement installer malware scanning and code signing;
- complete legal, privacy, tax, licensing, and compliance documentation.
