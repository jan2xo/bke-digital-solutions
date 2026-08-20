# Fresh VPS Bootstrap

Start with supported Ubuntu, Docker Engine/Compose v2, GitHub access, owner
secret-store access, DNS/ACME access, and an offsite backup plus its encryption
key. Then:

```bash
git clone <repository-url> bke-digital-solutions
cd bke-digital-solutions
git checkout <approved-commit>
cp .env.production.example .env.vps
chmod 600 .env.vps
docker compose --env-file .env.vps -f docker-compose.production.yml config --quiet
npm run config:validate
npm run deployment:verify-manifest
docker compose --env-file .env.vps -f docker-compose.production.yml up -d postgres valkey
docker compose --env-file .env.vps -f docker-compose.production.yml --profile self-hosted-storage up -d minio minio-init
docker compose --env-file .env.vps -f docker-compose.production.yml --profile operations run --rm migrate
docker compose --env-file .env.vps -f docker-compose.production.yml up -d app scheduler backup-worker caddy
docker compose --env-file .env.vps -f docker-compose.production.yml ps
curl --fail https://<production-host>/api/health/live
curl --fail https://<production-host>/api/health/ready
```

Populate `.env.vps` from the owner secret store; never use placeholders. MinIO
is private and Caddy is the public HTTPS entry point. Enable Docker at boot with
`sudo systemctl enable --now docker`; do not run `prisma migrate dev`, seed
production, or expose PostgreSQL/Valkey/MinIO ports.

Required off-server material includes database credentials, session/MFA keys,
license pepper, commercial and supply-chain signing keys plus public-key history,
MinIO credentials, PayMongo/Resend credentials, provider encryption keys,
backup S3 credentials, `BACKUP_ENCRYPTION_KEY`/version, and ACME/DNS access.
Restore historical signing/encryption material; do not regenerate it blindly.
