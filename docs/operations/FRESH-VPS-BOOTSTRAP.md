# Fresh VPS Bootstrap

Start with supported Ubuntu, Docker Engine/Compose v2, Git, Node.js 22.12+, repository access, owner secret-store access, DNS/ACME access, and the required offsite backup material.

Clone and enter the approved repository:

```bash
git clone <repository-url> bke-digital-solutions
cd bke-digital-solutions
git checkout <approved-commit>
```

Then use the V3 operator:

```bash
./bke.sh setup
./bke.sh env
./bke.sh deploy
```

That is the canonical first-deployment path. Do not hand-build a separate VPS environment filename; the runtime file is always ignored `.env`.

`./bke.sh setup` creates `.env` from `.env.example` only when missing and applies mode 600. Populate it from the owner secret store before deploying. Never leave example/local values in a production deployment.

After deployment:

```bash
./bke.sh status
./bke.sh health
```

For later releases:

```bash
./bke.sh update
```

Enable Docker at boot with `sudo systemctl enable --now docker`. The BKE operator deliberately does not install host packages, alter firewall/DNS configuration, delete Docker volumes, seed production, run `prisma migrate dev`, or regenerate historical signing/encryption material.

Required off-server material includes database credentials, session/MFA keys, license pepper, commercial and supply-chain signing keys plus public-key history, MinIO credentials, PayMongo/Resend credentials, provider encryption keys, backup S3 credentials, `BACKUP_ENCRYPTION_KEY`/version, and ACME/DNS access.
