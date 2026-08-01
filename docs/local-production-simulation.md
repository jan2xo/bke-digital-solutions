# Local production simulation

This is the primary pre-VPS environment. Cloudflare terminates public HTTPS and the named tunnel forwards HTTP to Caddy on loopback. Caddy forwards the original public host and `X-Forwarded-Proto=https` to the production Next.js image. PostgreSQL, Valkey, and MinIO remain private.

```text
Browser / provider -> HTTPS Cloudflare -> named tunnel
-> http://localhost:8080 -> Caddy -> app:3000
-> PostgreSQL / Valkey / MinIO
```

Only Caddy binds a host port: `127.0.0.1:8080`. The real domain works only while Docker, Caddy, the connector, the Mac, and its network connection remain available.

## Environment model

- `.env`: ordinary localhost development; mock/log providers by default.
- `.env.certification.example`: safe committed template.
- `.env.certification`: ignored owner-managed test credentials and certification values.
- `.env.production.example`: safe future VPS template.
- `.env.production`: future ignored VPS values.

The certification canonical origin is `https://jl-bke.com`; internal Docker traffic uses `http://app:3000`. Changing `.env.certification` requires `npm run certification:compose -- refresh` because existing containers do not reload environment files.

## Commands

```bash
npm run certification:check
npm run certification:compose -- config
npm run certification:compose -- up
npm run certification:compose -- migrate
npm run certification:compose -- seed
npm run certification:compose -- smoke
npm run certification:compose -- status
curl --fail http://127.0.0.1:8080/api/health/live -H 'Host: jl-bke.com'
curl --fail https://jl-bke.com/api/health/ready
npm run certification:compose -- logs
npm run certification:compose -- down
```

Use `npm run certification:compose -- admin` to bootstrap an owner-controlled administrator in the certification database. Set the documented acknowledgement plus admin email, name, and a temporary 12+ character password only in ignored `.env.certification`; remove the password afterward. The database is independent of development and production. Administrators must complete MFA enrollment and retain recovery codes privately.

The first owner session used the wrong Compose base before correcting it. The required base is `docker-compose.production.yml`, the override is `docker-compose.certification.yml`, the project is `bke-certification`, and the storage profile is `self-hosted-storage`. Do not run provider Vitest suites inside the slim application image; it intentionally excludes development test tools.
