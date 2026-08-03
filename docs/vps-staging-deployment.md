# VPS staging deployment runbook

This runbook deploys BKE Digital Solutions to a VPS for controlled testing. It supports either pulling the repository with Git or copying the local working tree over SSH.

No VPS has been deployed as of August 2026. Cloudflare is authoritative DNS for `jl-bke.com`; Namecheap is the registrar only. Use environment variables for every origin and hostname. See the [infrastructure baseline](./infrastructure-baseline.md).

It does **not** certify the platform for live payments. Start with mock payments and log-only email. PayMongo sandbox and Resend must pass their separate credential-gated checks before they are enabled.

## 1. Choose the deployment mode

### Recommended: staging hostname with HTTPS

Use the canonical hostname `jl-bke.com`, create its VPS DNS record in Cloudflare, and allow inbound TCP ports 80 and 443. Caddy will obtain and renew the TLS certificate.

Use:

```env
NODE_ENV=production
DEPLOYMENT_ENV=staging
APP_URL=https://jl-bke.com
APP_DOMAIN=jl-bke.com
```

Staging requires an HTTPS S3-compatible endpoint. The included MinIO service is suitable for local or temporary smoke testing, but it is not exposed with TLS by the included Caddy configuration.

### Temporary: VPS IP without a domain

For a short-lived smoke test only, Caddy can serve HTTP on port 80:

```env
NODE_ENV=production
DEPLOYMENT_ENV=development
APP_URL=http://VPS_PUBLIC_IP
APP_DOMAIN=:80
```

This mode intentionally uses `DEPLOYMENT_ENV=development` because staging and production reject HTTP. Do not enter real customer information, real payment credentials, or production secrets in this mode. Replace it with a real HTTPS hostname before external-provider testing.

## 2. VPS prerequisites

The VPS should have:

- a current 64-bit Linux distribution;
- at least 2 CPU cores, 4 GB RAM, and sufficient persistent disk for PostgreSQL and installers;
- Docker Engine and the Docker Compose v2 plugin;
- Git for the Git-pull method;
- SSH access using keys;
- a firewall allowing SSH and, when using Caddy, ports 80 and 443;
- outbound HTTPS access for container images, email, payments, object storage, and ACME.

Verify:

```bash
docker --version
docker compose version
git --version
```

Create a deployment directory owned by the deployment user:

```bash
sudo mkdir -p /opt/bke-digital-solutions
sudo chown "$USER":"$USER" /opt/bke-digital-solutions
```

## 3A. Transfer with Git

The deployment-foundation baseline commit is:

```text
20470c44d45cc81c7f73e5e92401b41e9afca003
```

Push the current reviewed `main` commit to the remote before attempting the VPS clone. For a private repository, configure a read-only GitHub deploy key on the VPS; do not place a personal access token in the repository or remote URL.

```bash
cd /opt
git clone git@github.com:YOUR_GITHUB_OWNER/bke-digital-solutions.git
cd /opt/bke-digital-solutions
git fetch --all --prune
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```

Confirm that `git rev-parse HEAD` prints the current reviewed release commit. It may be newer than the baseline above when documentation-only follow-up commits exist. `--ff-only` prevents an accidental merge on the server.

For later releases:

```bash
cd /opt/bke-digital-solutions
git fetch origin
git checkout main
git pull --ff-only origin main
```

## 3B. Transfer directly from the Mac

Run this from the parent directory on the Mac. Replace `deploy` and `VPS_PUBLIC_IP`:

```bash
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'test-results/' \
  --exclude 'playwright-report/' \
  ./bke-digital-solutions/ \
  deploy@VPS_PUBLIC_IP:/opt/bke-digital-solutions/
```

`--delete` keeps the remote application directory identical to the local source. Use it only with the exact `/opt/bke-digital-solutions/` target shown above. Runtime data is stored in Docker volumes and the secret environment file is excluded, so neither is deleted by this command.

## 4. Create the private environment file

On the VPS:

```bash
cd /opt/bke-digital-solutions
cp .env.production.example .env.vps
chmod 600 .env.vps
```

Edit `.env.vps`. It is ignored by Git and must never be committed. Add this line so Compose services load the same file:

```env
BKE_ENV_FILE=.env.vps
```

At minimum, replace and verify:

```env
NODE_ENV=production
DEPLOYMENT_ENV=staging
DEPLOYMENT_ID=bke-staging
APP_URL=https://jl-bke.com
APP_DOMAIN=jl-bke.com
ACME_EMAIL=security@jl-bke.com

POSTGRES_DB=bke
POSTGRES_USER=bke_application
POSTGRES_PASSWORD=GENERATE_A_LONG_DATABASE_PASSWORD
DATABASE_URL=postgresql://bke_application:URL_ENCODED_DATABASE_PASSWORD@postgres:5432/bke
DIRECT_DATABASE_URL=

SESSION_SECRET=GENERATE_AT_LEAST_48_RANDOM_CHARACTERS
MFA_ENCRYPTION_KEY=GENERATE_A_SEPARATE_48_CHARACTER_SECRET
LICENSE_PEPPER=GENERATE_A_DIFFERENT_48_CHARACTER_SECRET
CRON_SECRET=GENERATE_ANOTHER_48_CHARACTER_SECRET

REDIS_URL=redis://valkey:6379
REDIS_KEY_PREFIX=bke-staging

S3_ENDPOINT=https://YOUR_PRIVATE_STORAGE_ENDPOINT
S3_REGION=auto
S3_BUCKET=bke-staging-private
S3_ACCESS_KEY_ID=YOUR_BUCKET_SCOPED_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_BUCKET_SCOPED_SECRET
S3_FORCE_PATH_STYLE=false

PAYMENT_PROVIDER=mock
PAYMONGO_SECRET_KEY=
PAYMONGO_WEBHOOK_SECRET=
PAYMONGO_LIVEMODE=false

EMAIL_PROVIDER=log
RESEND_API_KEY=
EMAIL_FROM=BKE Digital Solutions <noreply@jl-bke.com>
SUPPORT_EMAIL=support@jl-bke.com

ALLOW_DESTRUCTIVE_ADMIN=false
```

Generate each application secret independently:

```bash
openssl rand -base64 48
```

If the database password contains reserved URL characters, URL-encode it in `DATABASE_URL`. Keep the plain value only in `POSTGRES_PASSWORD`.

For the temporary no-domain mode, use a unique `bke-vps-smoke` deployment ID/prefix, `APP_URL=http://VPS_PUBLIC_IP`, `APP_DOMAIN=:80`, and `DEPLOYMENT_ENV=development`. Self-hosted MinIO may then use `S3_ENDPOINT=http://minio:9000` with `S3_FORCE_PATH_STYLE=true`.

## 5. Validate configuration and build

Install Node.js 22.12 or newer on the VPS because the seed and administrator bootstrap scripts run from the checked-out source. Validate the application environment before touching the database:

```bash
cd /opt/bke-digital-solutions
cp .env.vps .env
chmod 600 .env
npm ci
npm run config:validate
npm run db:generate
```

Validate Compose interpolation without printing the resolved environment:

```bash
cd /opt/bke-digital-solutions
docker compose --env-file .env.vps -f docker-compose.production.yml config --quiet
```

Build the application and migration images:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml build app migrate
```

The build must finish successfully. Do not continue after a configuration or image-build failure.

## 6. Start data services and storage

For managed S3-compatible storage:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml up -d postgres valkey
```

For temporary self-hosted MinIO smoke testing:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml --profile self-hosted-storage up -d postgres valkey minio
```

Create the private bucket before starting the application. The bucket name must exactly match `S3_BUCKET`. Use the MinIO client or your storage provider console, keep public access disabled, and confirm the application credentials can list, upload, download, and delete only objects in that bucket.

Check service status:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml ps
```

## 7. Apply migrations exactly once

Take a database backup before upgrading an existing deployment. For a new empty staging database, run:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml --profile operations run --rm migrate
```

Never use `prisma migrate dev` on the VPS. The migration job must exit with status zero before starting the application.

## 8. Seed and create the administrator

The seed and administrator scripts run from the checked-out source. The dependencies and validated `.env` from step 5 are reused:

```bash
cd /opt/bke-digital-solutions
npm run db:seed
ADMIN_BOOTSTRAP_ACK=I_UNDERSTAND_THIS_CREATES_A_PRIVILEGED_ACCOUNT npm run admin:create
```

The administrator password must contain at least 12 characters. Interactive input may be visible in the terminal, so perform this over a private SSH session and clear the terminal afterward. Do not put the administrator password in `.env.vps`, shell history, Docker Compose, Git, or deployment logs. On first sign-in, complete mandatory email-code enrollment and store the one-time recovery codes offline before performing any administrator operation.

After bootstrapping, the host `node_modules` directory may be removed if desired; it is not used by the production application container.

## 9. Start the application

With a real hostname and HTTPS:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app caddy
```

For the no-domain HTTP smoke mode, the same command works when `APP_DOMAIN=:80`, but it must never be treated as a secure staging or production environment.

Inspect status and redacted logs:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml ps
docker compose --env-file .env.vps -f docker-compose.production.yml logs --tail=100 app caddy
```

Do not paste environment dumps, checkout URLs, webhook signatures, license keys, or customer data into support messages.

## 10. Verify the deployment

For HTTPS staging:

```bash
curl --fail --silent --show-error https://jl-bke.com/api/health/live
curl --fail --silent --show-error https://jl-bke.com/api/health/ready
curl --fail --silent --show-error https://jl-bke.com/products >/dev/null
```

For the no-domain smoke mode, replace the origin with `http://VPS_PUBLIC_IP`.

Then verify manually with synthetic accounts:

1. Administrator password login, mandatory email-code enrollment/challenge, resend invalidation, recovery-code storage, and logout.
2. Product, edition, plan, version, and installer creation.
3. Customer registration and development verification flow.
4. Mock checkout and verified mock webhook completion.
5. Invoice lines, including separate annual and promotional discounts.
6. License issuance, installer authorization, and one-time download grant.
7. Device activation, device limit, and deactivation.
8. Subscription renewal, cancellation, expiration, and refund revocation.
9. Another customer cannot access the order, invoice, license, installer, or administrator routes.

## 11. Cron jobs

Configure a scheduler to call the protected endpoints using the independent `CRON_SECRET`:

```text
POST /api/cron/email-outbox
POST /api/cron/renewals
POST /api/cron/expirations
Authorization: Bearer CRON_SECRET
```

Use a secret-aware scheduler. Do not embed the bearer token in a public repository or ordinary crontab output that other system users can read.

## 12. Updating an existing VPS

For Git deployments:

```bash
cd /opt/bke-digital-solutions
git fetch origin
git pull --ff-only origin main
docker compose --env-file .env.vps -f docker-compose.production.yml build app migrate
docker compose --env-file .env.vps -f docker-compose.production.yml --profile operations run --rm migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app caddy
```

For local-copy deployments, repeat the `rsync` command first, then run the same build, migration, and start commands.

Always back up PostgreSQL and private object storage before migrations. Confirm live and ready health after every update.

## 13. Rollback

Application rollback is commit/image based:

```bash
git log --oneline -10
git checkout PREVIOUS_VERIFIED_COMMIT
docker compose --env-file .env.vps -f docker-compose.production.yml build app
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app caddy
```

Database migrations are forward-only. Do not run destructive manual SQL or remove a migration record. If an applied migration is incompatible with an older application image, deploy a reviewed forward fix or follow the verified database restore procedure.

## 14. Stop or remove the staging deployment

Stop containers while preserving PostgreSQL, Valkey, certificates, and object data:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml down
```

Do **not** add `--volumes` unless you intentionally want to permanently erase the staging database, Valkey state, Caddy certificates, and self-hosted object storage.

## Remaining production blockers

A successful VPS smoke deployment does not remove these gates:

- real PayMongo sandbox checkout and signed webhook lifecycle;
- credential-gated Resend delivery and operational-event testing from the verified `jl-bke.com` domain;
- encrypted database and object-storage backups plus a restore drill;
- external monitoring, log retention, and alerting;
- private S3/MinIO access review and installer malware scanning;
- software/code signing;
- production DNS and HTTPS;
- legal, privacy, tax, and BIR invoicing review;
- secret rotation and incident-response exercises.

Keep `PAYMENT_PROVIDER=mock` and `EMAIL_PROVIDER=log` until their respective sandbox certification steps pass.
