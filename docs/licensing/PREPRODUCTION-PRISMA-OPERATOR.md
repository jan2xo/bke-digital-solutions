# Fresh Neon preproduction — official Prisma migration operator

Parent: [Licensing Agent startup acceptance #130](https://github.com/jan2xo/bke-licensing-agent/issues/130).

**Scope: source-only protected operator and its denial tests.** This DOES NOT mean actual migrations have run, a staging Worker has deployed, signer custody exists, or installed Windows startup is accepted.

## Independently verified resource identity (2026-11-13 UTC)

| Field | Immutable approved value |
|---|---|
| Organization | BKE DIGITAL SOLUTIONS, `org-super-mountain-11775863` |
| Neon project | `tiny-mouse-06099628` / `bke-digital-solutions-preproduction` |
| Project region / PostgreSQL | `aws-ap-southeast-1` / 17 |
| Root branch | `br-divine-dream-a1qhc381` / `preproduction`, no parent |
| Direct **read-write** compute | `ep-polished-glade-a1u174wx.ap-southeast-1.aws.neon.tech` |
| Database / role | `bke_preproduction` / `bke_preproduction_owner` |
| Production Neon (FORBIDDEN) | `lingering-pond-33730332` |
| Legacy staging (FORBIDDEN) | `bold-hat-55602908` |

The newly created database had **zero** public application tables, **no** official migration ledger and zero mock schemas on initial independent control-plane/SQL readback.

## Required human-controlled secret custody — NOT set up by this PR

An authorized owner must independently establish a **separate** Infisical project/identity limited to the new preproduction database, **not** reuse the configured production/legacy staging identity, keys, Google login or provider credentials.

Configure the GitHub **Preproduction** environment, protect it with appropriate reviewer and branch restrictions, and set these environment **variables** (not workflow-dispatch inputs):

- `INFISICAL_PREPRODUCTION_IDENTITY_ID`: dedicated preproduction OIDC identity ID
- `INFISICAL_PREPRODUCTION_PROJECT_ID`: dedicated preproduction secret project ID; must differ from the known legacy staging project `f029af60-06f3-428c-b305-c70f8bcf7850`

Inside that Infisical project, dedicate the `staging` environment and **`/prisma` secret path** exclusively to the following two values:

- `NEON_API_KEY`: narrow preproduction Neon project control-plane API key (read project, root branch and endpoints only; least privileges available)
- `DIRECT_DATABASE_URL`: **direct/unpooled**, TLS-required URL for exactly the above host, database and role; never use a prod/staging URL, and do not expose it in logs or commits

Do **not** place credentials in GitHub workflow inputs, repository files, PR comments, artifacts, or chat. No live payment/email keys, Redis keys, signing keys or customer data are used for schema preparation.

## Execution after source certification and protected configuration

The workflow `.github/workflows/preproduction-prisma.yml` is **workflow_dispatch only**, with main-branch SHA, repository owner, explicit mode, purpose-specific confirmation, GitHub Preproduction environment and independent Infisical OIDC. It has no PR/push trigger. It can only run on the current exact merged `main` head, not an arbitrary candidate.

For the initial migration, dispatch at that exact main with:

- mode: `apply_official_migrations`
- confirmation: `APPLY_OFFICIAL_PRISMA_TO_FRESH_BKE_PREPRODUCTION`

The protected job verifies the source/checkouts, Neon organization/project/root branch/read-write compute from Neon's API and the exact DB host/role/database with PostgreSQL read-only SQL before running the real `npm run db:deploy` (Prisma CLI). It then calls `npm run db:status`, independently verifies every checked-in official `prisma/migrations/*/migration.sql` SHA-256 against the official database migration ledger, checks a read-only application schema smoke, reapplies official Prisma deploy to verify idempotence and repeats verification.

For a repeat inspection of the fully migrated database, use mode `verify_only` and confirmation `VERIFY_OFFICIAL_PRISMA_BKE_PREPRODUCTION`. It does not request changes or run migrate deploy.

**Any missing protected identity/secret, differing SQL target, wrong Neon API branch parent/project/endpoint, nonempty initial database, unknown tables/schema, migrations not matching exact source, unexpected input, stale SHA or new source head FAILS CLOSED.** Do not create credentials automatically or fall back to other environments.

## Evidence boundaries

The migration workflow applies database schema only. It does not perform `prisma db seed`, create fake users, commercial licenses, machine keys, signer keys, billing/email events, update any Cloudflare resource or publish any release. Its own execution and readback are separately required proof; merely merging the workflow is source-only certification.

Initial release of this operator requires `pr core platform prisma-isolation host` exact-head source CI. A **real** migration requires manual owner dispatch, independently configured protected preproduction secrets/approval, and green audited run+control-plane readback. `preproduction:startup:readiness` intentionally remains RED until genuine signed issuer/machine/product and two-admin evidence are separately supplied.

**Production is strictly locked.**
