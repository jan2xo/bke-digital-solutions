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

## Required human-controlled secret custody — reuse existing staging-only Infisical project

The operator uses the already existing **BKE DIGITAL SOLUTIONS STAGING** Infisical project `f029af60-06f3-428c-b305-c70f8bcf7850`, at the owner's explicit request, **not a new Infisical project**. This is a staging-only *secret-storage project*. It is separate from the **NEW Neon preproduction database** and is **not** the older legacy staging Neon database `bold-hat-55602908`. Production Neon and production Infisical projects/identities/keys are forbidden.

The owner-supplied Infisical screenshot (2026-11-14 PHT) shows a single masked `DIRECT_DATABASE_URL` inside this staging-named project, under its **Development** environment and **root `/` path**. `Development` maps to **Infisical environment slug `dev`**; the Infisical project's name is not its environment slug. The masked value is not independently readable from the screenshot, so the runner must validate the direct SQL URL before migrations.

Protect the GitHub **Preproduction** environment with appropriate reviewers and `main` branch restriction. The existing environment **variables**, not secrets or workflow inputs, must be:

- `INFISICAL_PREPRODUCTION_IDENTITY_ID`: dedicated, owner/repository/main-bound GitHub OIDC machine identity (must not match existing staging-Workers CI identity or production identity)
- `INFISICAL_PREPRODUCTION_PROJECT_ID`: **exactly** `f029af60-06f3-428c-b305-c70f8bcf7850`, the existing staging-only Infisical project

The GitHub Infisical action MUST use exactly:

- `env-slug: dev` (the actual Development dropdown shown by the owner)
- `secret-path: /` (the actual root shown by the owner)
- `secret-name: DIRECT_DATABASE_URL` to fetch **only this one key**; missing secret FAILS CLOSED
- `include-imports: "false"` and `recursive: "false"` (no other root/shared/imported secrets)
- `method: oidc` with the dedicated preproduction machine identity

`DIRECT_DATABASE_URL` must be **direct/unpooled**, TLS-required and point exactly to the independent Neon hostname/role/database pinned above. The runner validates all of these before any SQL write. Prisma 7 reads it through `prisma.config.ts`; **NEON_API_KEY is not required**.

**Explicit sharing tradeoff:** this reuses one staging-only **Infisical project** and the existing Development root; project-level administrators/access policy can affect that secret. It does NOT share Neon project, branch, database, role, provider credential, application runtime, or production keys. The dedicated OIDC identity must be granted minimum read-only access to the appropriate environment/key; do not expand its scope to production. The workflow's `secret-name` selector prevents exporting other secrets even if later added at `/`. If the machine identity cannot fetch the specified secret, repair that staging-project read grant, not the protected target controls.

Do **not** place credentials in GitHub workflow inputs, repository files, PR comments, artifacts, or chat. No live payment/email keys, Redis keys, signing keys or customer data are used for schema preparation.

## Execution after source certification and protected staging project configuration

The canonical workflow `.github/workflows/preproduction-prisma.yml` supports normal owner-only `workflow_dispatch`, and **temporarily** one directly received `issue_comment` from repository owner `jan2xo` **only on issue #378**. Both paths require exact current merged `main` SHA, purpose-specific confirmation, GitHub Preproduction environment and independent Infisical OIDC. The comment path checks actor, author, issue type/number, exact body and current main *before OIDC*, and runtime independently checks the trusted GitHub event payload before SQL. It has **no PR/push trigger** and never authorizes `github-actions[bot]` for schema writes. Temporary comment support must be removed after complete live official Prisma proof.

For the initial migration, dispatch at that exact main with:

- mode: `apply_official_migrations`
- confirmation: `APPLY_OFFICIAL_PRISMA_TO_FRESH_BKE_PREPRODUCTION`

**Protected CLI ordering:** checkout and `npm ci` happen without database secrets; the one Infisical `DIRECT_DATABASE_URL` secret is then loaded through OIDC; for first-time migration, read-only SQL preflight verifies the pinned clean database **before** `npm run db:generate`. Prisma config requires this URL even for client generation (`prisma.config.ts` uses `DIRECT_DATABASE_URL || DATABASE_URL`), so do not move `db:generate` ahead of secret retrieval or introduce a second `DATABASE_URL` secret. The workflow performs official migration only after exact-main recheck.

The protected job verifies exact current merged source, the **pinned Neon direct RW TLS hostname**, database and login role against the approved independent Neon root established by read-only control-plane inspection on 2026-11-14. It then checks current SQL identity, no mock schemas, and empty application schema **before** the real `npm run db:deploy` (Prisma CLI). It calls `npm run db:status`, independently verifies every checked-in official `prisma/migrations/*/migration.sql` SHA-256 against the official migration ledger, checks a read-only application schema smoke, reapplies the official deploy to verify idempotence and repeats verification.

For the temporary **autonomous owner-comment** path, the exact comment on [issue #378](https://github.com/jan2xo/bke-digital-solutions/issues/378) is:

`/preproduction-prisma apply <current-exact-merged-main-sha> APPLY_OFFICIAL_PRISMA_TO_FRESH_BKE_PREPRODUCTION`

The workflow itself validates it; no separate GitHub Actions token dispatcher (which would be `github-actions[bot]`) is used. This entrypoint is limited to **first-time preproduction schema migration**; once complete, remove the temporary issue-comment trigger through an exact-head-certified source cleanup. The manual workflow_dispatch operator remains available.

For a repeat inspection of the fully migrated database, use mode `verify_only` and confirmation `VERIFY_OFFICIAL_PRISMA_BKE_PREPRODUCTION`. It does not request changes or run migrate deploy.

**Any missing protected identity/secret, differing pinned TLS host, database/role, nonempty initial database, unknown tables/schema, migrations not matching exact source, unexpected input, stale SHA or new source head FAILS CLOSED.** Do not create credentials automatically or fall back to other environments.

**Explicit tradeoff:** the runner no longer re-queries the Neon management API at dispatch time because that would require a second privileged credential. Its project/root-to-host mapping was independently verified before this source change (project `tiny-mouse-06099628`, root `br-divine-dream-a1qhc381`, non-cloned, one RW endpoint). Runtime proof verifies the pinned direct TLS endpoint and actual SQL identity **but does not dynamically re-attest Neon project/branch metadata**. Before any protected migration dispatch, an authorized operator must recheck those fixed Neon project/root/endpoint identities in the Neon console or via an independent read-only API connector. Production remains locked.

## Evidence boundaries

The migration workflow applies database schema only. It does not perform `prisma db seed`, create fake users, commercial licenses, machine keys, signer keys, billing/email events, update any Cloudflare resource or publish any release. Its own execution and readback are separately required proof; merely merging the workflow is source-only certification.

Initial release of this operator requires `pr core platform prisma-isolation host` exact-head source CI. A **real** migration requires manual owner dispatch, independently configured protected preproduction secrets/approval, and green audited run+control-plane readback. `preproduction:startup:readiness` intentionally remains RED until genuine signed issuer/machine/product and two-admin evidence are separately supplied.

**Production is strictly locked.**
