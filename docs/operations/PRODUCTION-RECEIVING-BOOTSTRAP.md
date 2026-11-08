# BKE Digital Solutions — Fresh Production database receiving bootstrap

**Intent:** Build the application schema in the existing canonical Neon `production` branch for the Cloudflare Workers website **without activating real commerce or changing the public Worker**. The VPS Production service has no available recovery source; historical accounts, orders, entitlements, and license records are intentionally **not imported**. The existing legacy Staging database is **not** a substitute.

## Verified target (2026-11-08)

- Neon project: `bke-digital-solutions` (`lingering-pond-33730332`).
- Branch: `production` (`br-autumn-morning-az7buyxu`); DB `bke_production`; role `bke_production_owner`.
- Direct PostgreSQL hostname: `ep-raspy-bread-azsc0112.c-3.ap-southeast-1.aws.neon.tech`. **Never use a `-pooler` host here.**
- Cloudflare Production Hyperdrive: `bke-digital-solutions-production` (`ea1691c683e64bd0b9acc3489ab7759c`), origin matching direct Neon, SQL cache disabled, TLS `require`.
- GitHub environment **`Production`**, Infisical existing project **BKE DIGITAL SOLUTIONS**, secrets environment slug **`prod`**, path `/`. Application `DEPLOYMENT_ENV` must remain `production`.

## Protected preparation inputs

GitHub Production variables:
- `PRODUCTION_NEON_HOST` (direct hostname above)
- `HYPERDRIVE_ID` (immutable Production Hyperdrive ID above)
- `INFISICAL_PRODUCTION_PROJECT_ID` (owner-verified existing BKE DIGITAL SOLUTIONS project)
- `INFISICAL_PRODUCTION_IDENTITY_ID` (Production-only GitHub OIDC machine identity, to be configured)

GitHub Production secret:
- `CLOUDFLARE_API_TOKEN` (read access to the exact Production Hyperdrive for schema verification, least privilege)

Infisical `prod` secrets/variables required for **schema-only preparation**:
- `APP_URL=https://bkedigitalsolutions.com`
- `DEPLOYMENT_ENV=production`
- `DATABASE_URL` and `DIRECT_DATABASE_URL`: identical direct Neon PostgreSQL URLs, verified role/DB/host and required TLS query parameter.

No PayMongo live credentials, Google OAuth, Redis, licensing keys, production email, or payment activation are required to **create an empty application schema**. Those are **still mandatory before production website activation**, through the unchanged commercial preflight.

## Approved execution sequence

1. Verify GitHub Production branch policy, required reviewer approval, Infisical GitHub OIDC binding, and read-only Hyperdrive access. Do not paste secrets into GitHub discussions.
2. Verify the exact current `main` SHA. Explicitly dispatch `ci.yml` on that exact SHA with `deploy_staging=false`; record successful `CI` run ID and `Required certification` result for that SHA.
3. After the user explicitly authorizes the schema mutation, dispatch the existing protected workflow on `main`:
   ```bash
   gh workflow run live-paymongo-cutover.yml --repo jan2xo/bke-digital-solutions --ref main \
     -f source_sha="$MAIN_SHA" -f required_ci_run_id="$CI_RUN_ID" \
     -f mode=prepare_database -f confirmation=PREPARE_PRODUCTION_SCHEMA
   ```
4. GitHub's **Production** environment requires owner review. The workflow checks exact-main certification, source SHA, OIDC Infisical `prod` source, direct Neon URL identity and matching cache-disabled TLS Hyperdrive **before** applying source-reviewed Prisma migrations.
5. Successful workflow output requires `npm run db:generate`, generated-client diff check, `npm run db:deploy` and `npm run db:status`. Independently verify the new `public` tables on canonical Neon Production. Empty tables are correct; there is no historical data restoration.
6. Do **not** select `deploy_live` or repoint the public Worker, domain, licensing, or live PayMongo at this stage. The separately protected commerce/website cutover requires live provider credentials, Redis isolation, backups/restore evidence, approved commercial legal documents, Google OAuth, and signed payment-webhook reconciliation.

## Failure behavior

- Production OIDC unavailable / Production reviewer missing: **stop**; do not copy private credentials to CI logs or project files.
- Mismatched database role, host, TLS, nonproduction origin, Hyperdrive cache enabled or TLS unset: **stop**.
- Prisma migration failure: inspect only the failed migration, do not `db push`, reset, force-deploy or import legacy Staging.
- A successful schema bootstrap is **not** evidence the website, Google login, PayMongo or entitlements are accepting customers.
