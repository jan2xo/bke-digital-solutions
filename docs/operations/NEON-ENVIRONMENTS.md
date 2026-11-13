# BKE Digital Solutions — canonical Neon environment topology

> **PREPRODUCTION AUTHORITY UPDATE — 2026-11-13:** This document records the historical 2026-11-08 shared-project topology, not the current installed-startup licensing issuer target. The independently created NEW `bke-digital-solutions-preproduction` Neon project (`tiny-mouse-06099628`), root branch `br-divine-dream-a1qhc381`, database `bke_preproduction`, is now the **only approved target for fresh official Prisma preproduction schema preparation** under Agent #130. The canonical production and legacy staging projects remain separate and locked. Do not apply official preproduction issuer migrations to the production project's staging/development branches, or the retained mock child. See [the protected migration operator](../licensing/PREPRODUCTION-PRISMA-OPERATOR.md). This exception deliberately isolates licensing trust authority from the shared branch/project administrative boundary described below; it does not change the production topology. The new project is initially empty and is **not migrated/deployed** merely because it exists.

**Architecture rule:** one long-lived Neon project per application, named **`bke-digital-solutions`**. Environments live in independently connected **branches**, not in separate projects called `*-production`, `*-staging`, or `*-development`. Preserve generation-independent environment variable names.

## Current verified resource registry (2026-11-08)

| Environment | Canonical project | Branch / ID | Database | Database owner |
| --- | --- | --- | --- | --- |
| Production | `bke-digital-solutions` (`lingering-pond-33730332`) | `production` (`br-autumn-morning-az7buyxu`), default | `bke_production` | `bke_production_owner` |
| Staging target | same project | `staging` (`br-hidden-shape-az7g4y2f`) | `bke_staging` | `bke_staging_owner` |
| Development target | same project | `development` (`br-misty-thunder-az3g9r63`) | `bke_development` | `bke_development_owner` |

All branches are PostgreSQL 17, Singapore region, from an initially **empty** `production` baseline. Each has a different branch-specific compute endpoint. The two newly created nonproduction branches had inherited empty `bke_production` databases and roles removed after their own environment-specific databases and owner roles were created. No production or staging user records were copied or promoted.

### Temporary legacy Staging

The **currently deployed public mock-only Worker** is still backed by a separate older Neon project, now visibly labeled `bke-digital-solutions-legacy-staging` (`bold-hat-55602908`, branch `br-fragrant-salad-azee6zgq`). This is **temporary legacy infrastructure**, not the canonical target. Renaming the project changes no hostname, role, secret or connection binding. The new `staging` branch is not automatically a migration of the older Staging application's data.

**Never delete or repoint legacy Staging** until its schema/data migration, protected Worker Hyperdrive binding, Google sign-in acceptance, mock-payment configuration, backup and rollback are proved. Never point the public Worker at the empty canonical Staging branch and represent it as the current live data source.

## Required environment isolation

1. Branches must use **distinct direct Neon endpoint hostnames**, environment-owned databases, distinct roles/credentials, and separate Hyperdrive configurations. Set `PRODUCTION_NEON_HOST` to the verified direct host of **production**, not a project-level/shared proxy or an endpoint from Staging.
2. Retain `bke_production` and `bke_production_owner` as the only expected database and role in the protected live-payments preflight. Existing `scripts/prepare-live-paymongo.mjs` checks those values and requires direct Neon TLS, genuine live PayMongo mode, a cache-disabled production Hyperdrive, and distinct Redis namespace.
3. Staging and development must not use production passwords, payment keys, webhook secrets, Google OAuth production credentials, email sender identity or production signing material. Secrets stay in properly scoped Infisical environments; no credentials or connection strings belong in repository files.
4. **Do not create or reset new nonproduction branches from production after production contains live user/financial data.** Neon branching copies the source branch snapshot, including customer data and roles. For future nonproduction refreshes, branch from a sanitized seed/baseline (or perform explicit approved anonymization), not a live production snapshot.
5. Project membership and controls span multiple branches. Treat this topology as a *shared administrative trust boundary* even with branch-specific connections. Restrict access and never treat mere branch separation as the same as separate projects for disaster recovery or access containment.
6. The current Neon **Free plan rejected enabling protection** on the Production branch (`maximum number of protected branches`). It is **not protected**. Do not claim branch-protection certification or unconditional production readiness. Resolve plan limits/access protection and verify independent encrypted backup/restore before commercial activation.

## Release / certification boundary

- GitHub canonical Digital Solutions main after PR #266 source integration: `032ac517f8115aacfc6a06a4407cbf3d4bbc07b9`. A GitHub source merge does **not** deploy the public Worker or apply production database migrations.
- Current canonical `bke_production` is newly created and **unmigrated**. The canonical Staging and Development target databases are likewise new, empty environment databases.
- The protected `.github/workflows/live-paymongo-cutover.yml` accepts an explicitly certified **exact current main** SHA and uses separate `Production` GitHub environment / Infisical OIDC; modes are `prepare_database`, `verify_only`, and `deploy_live`. Never confuse `prepare_database` with live deployment or reuse Staging's Infisical identity, Redis, Hyperdrive or legal test notices.
- Production cutover requires reviewed migration/rollback, genuinely approved commercial legal versions, real Google OAuth session acceptance, production-only Hyperdrive/Redis/backup resources, live PayMongo capability and signed webhook settlement/financial reconciliation. No payment charge or customer entitlement should be created until explicitly bounded acceptance.
- The Cloudflare connection in the 2026-11-08 execution environment could not be authenticated; no Cloudflare production resources were created/changed by the Neon naming operation.

## Environment naming convention

```text
Neon
└── bke-digital-solutions                  # application project
    ├── production                         # branch / bke_production
    ├── staging                            # branch / bke_staging
    └── development                        # branch / bke_development
```

**Naming maxim:** Project = application; branch = environment; database = environment-owned data; role = environment-owned database authority. No generation-style `V2_`/`V3_` prefixes in long-lived environment variable names.
