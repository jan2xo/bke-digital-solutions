# BKE Digital Solutions — Independent VPS Production Deployment

This runbook is self-contained for a fresh Ubuntu 24.04 VPS (including Hetzner). It does not contain credentials and does not claim that a VPS, DNS record, HTTPS certificate, or reboot drill has already succeeded.

## 0. Required owner inputs

Prepare a VPS public IP, SSH key, a non-root sudo user, the Cloudflare DNS zone for `jl-bke.com`, an HTTPS email address, production PostgreSQL/Valkey/storage credentials, PayMongo and Resend credentials, and an independent secret store. Never paste secrets into Git, shell history, tickets, or logs.

## 1. Host bootstrap (Ubuntu/Hetzner)

From your workstation, replace placeholders:

```bash
ssh root@VPS_PUBLIC_IP
apt-get update && apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw unattended-upgrades
adduser deploy
usermod -aG sudo,docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
# Install the owner's public key in /home/deploy/.ssh/authorized_keys.
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Install Docker Engine using Docker's official Ubuntu instructions, then verify:

```bash
systemctl enable --now docker
systemctl is-enabled docker                 # expected: enabled
systemctl is-active docker                  # expected: active
docker version
```

Log in as `deploy` for the remaining steps. Restrict SSH to the operator's network when practical and disable root/password SSH only after key login is verified.

## 2. Obtain the repository

Use a read-only deploy key or approved GitHub authentication. Do not embed a token in the remote URL.

```bash
sudo -iu deploy
sudo mkdir -p /opt/bke-digital-solutions
sudo chown deploy:deploy /opt/bke-digital-solutions
git clone REPOSITORY_URL /opt/bke-digital-solutions
cd /opt/bke-digital-solutions
git checkout main
git status --short                         # expected: empty
```

## 3. Production secrets

Create an ignored file outside Git:

```bash
install -m 600 /dev/null /opt/bke-digital-solutions/.env.vps
${EDITOR:-vi} /opt/bke-digital-solutions/.env.vps
```

Set every required value from `.env.production.example`, including a real HTTPS `APP_URL`, unique deployment ID, database credentials, session/license/MFA secrets, storage credentials, `PAYMENT_PROVIDER=paymongo`, `PAYMONGO_LIVEMODE=false` until live certification is approved, Resend credentials, backup encryption/key settings, and `APP_DOMAIN=jl-bke.com`. Do not use example placeholders.

Validate without printing resolved configuration:

```bash
cd /opt/bke-digital-solutions
BKE_ENV_FILE=.env.vps npm run config:validate
docker compose --env-file .env.vps -f docker-compose.production.yml config --quiet
```

## 4. Build, volumes, migrations, and startup

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml build app scheduler backup-worker migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d postgres valkey
docker compose --env-file .env.vps -f docker-compose.production.yml --profile self-hosted-storage up -d minio
docker compose --env-file .env.vps -f docker-compose.production.yml run --rm migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app scheduler backup-worker caddy
docker compose --env-file .env.vps -f docker-compose.production.yml ps
```

Expected: PostgreSQL/Valkey/MinIO report healthy, app is healthy, and scheduler/backup-worker/Caddy are running. `migrate` is intentionally a one-shot service with `restart: "no"`; every long-running service uses `restart: unless-stopped`.

Verify the repository guarantee:

```bash
BKE_ENV_FILE=.env.vps npm run deployment:verify-restart
```

## 5. Cloudflare and HTTPS

In Cloudflare DNS, create proxied `A`/`AAAA` records for `jl-bke.com` pointing to the VPS. Do not assume DNS is configured. Set SSL/TLS to Full (strict) after Caddy has a valid origin certificate. Caddy obtains certificates for `APP_DOMAIN` using `ACME_EMAIL`.

```bash
curl --fail https://jl-bke.com/api/health/live
curl --fail https://jl-bke.com/api/health/ready
```

Expected: HTTP 200 JSON. Verify security headers with `curl -sSI`; never cache authenticated pages or API responses at Cloudflare.

## 6. Bootstrap and smoke checks

Run the documented admin bootstrap with an acknowledgement and temporary password supplied only through the ignored environment. Enroll administrator MFA and store recovery codes offline. Then verify home, login, `/admin`, `/admin/releases`, `/admin/supply-chain`, `/admin/compliance`, `/admin/backups`, `/admin/observability`, customer checkout, download authorization, and license activation using test data only until payment certification is approved.

## 7. Cold-reboot certification

Record UTC timestamps and run:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml ps
sudo reboot
```

After reconnecting:

```bash
systemctl is-active docker
cd /opt/bke-digital-solutions
docker compose --env-file .env.vps -f docker-compose.production.yml ps
curl --fail https://jl-bke.com/api/health/ready
docker compose --env-file .env.vps -f docker-compose.production.yml logs --tail=100 app scheduler backup-worker caddy
```

Expected: Docker is active, all long-running services return automatically, readiness is 200, scheduler resumes, and no crash loop appears. This is owner evidence; repository inspection alone cannot certify it.

## 8. Updates and rollback

```bash
git fetch origin
git checkout APPROVED_COMMIT
docker compose --env-file .env.vps -f docker-compose.production.yml build app scheduler backup-worker migrate
docker compose --env-file .env.vps -f docker-compose.production.yml run --rm migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app scheduler backup-worker caddy
```

If migration or health checks fail, stop traffic, preserve logs, do not run `migrate dev`, and follow the disaster-recovery runbook. Roll back application code only when the schema remains compatible; otherwise restore an isolated copy and apply a reviewed forward migration.

## 9. Backup and disaster recovery

Confirm `BACKUP_ENABLED=true`, the backup worker is running, archives are encrypted, manifests verify, and the configured backup bucket is separate from live storage:

```bash
docker compose --env-file .env.vps -f docker-compose.production.yml logs --tail=200 backup-worker
docker compose --env-file .env.vps -f docker-compose.production.yml run --rm migrate npm run db:status
```

A successful backup is not a restore certification. Perform the isolated restore drill in `docs/restore-procedure.md` and record the evidence before declaring recovery ready.

## 10. Failure recovery

- Compose validation fails: inspect only the error, correct missing environment values, and rerun without printing resolved configuration.
- Migration fails: keep the application stopped, preserve the error, and use a reviewed forward fix or isolated restore.
- Caddy certificate fails: verify Cloudflare DNS, ports 80/443, `APP_DOMAIN`, and ACME email.
- Service restarts repeatedly: inspect `docker compose logs SERVICE`, dependency health, disk space, and permissions; do not delete volumes.
- Database/storage failure: follow the isolated restore procedure; never overwrite production during an unverified restore.

## Final checklist

- [ ] Docker enabled and active at boot
- [ ] Firewall allows only required ports
- [ ] Production secrets injected outside Git
- [ ] Compose validation passed
- [ ] 25 migrations applied with zero drift
- [ ] All long-running services use `unless-stopped`/`always`
- [ ] Migration service remains one-shot
- [ ] Cloudflare DNS and HTTPS verified by owner
- [ ] Health/readiness endpoints return 200
- [ ] Admin MFA enrolled
- [ ] Backup archive and manifest verified
- [ ] Isolated restore drill completed
- [ ] Full cold-reboot recovery observed and recorded
- [ ] Rollback commit identified
- [ ] Monitoring, legal/tax, signing, malware, and payment gates separately approved

Until every applicable item has evidence, production deployment is not certified.
