# Preproduction startup-policy issuer readiness — fail-closed READ-ONLY gate

Parent: [Agent installed positive acceptance #130](https://github.com/jan2xo/bke-licensing-agent/issues/130).
Source: Digital Solutions staging HTTP [PR #372](https://github.com/jan2xo/bke-digital-solutions/pull/372), Licensing Agent privileged one-shot consumer [PR #141](https://github.com/jan2xo/bke-licensing-agent/pull/141).

## Exact scope of this wave

This command **does not provision** a staging database, generate private
keys, register an Agent machine key, certify real human approvals, issue any
customer commercial credential, publish an installer, deploy a service or
grant Windows startup.

It is a **read-only** operator gate which must pass BEFORE enabling a real
staging standalone startup policy HTTP issuer. It requires a separately
controlled, **nonproduction** database and exactly matching protected
staging configuration. Production is STRICTLY LOCKED.

The legacy disposable Neon child
`bold-hat-55602908 / br-soft-dawn-az9q94rd / bke_staging` has 61
official Prisma migrations, nine subsequent SQL migrations manually
replayed, eight mock fixture records, and nine SQL-only lifecycle checks.
This **MUST NOT** pass the real issuer readiness gate, cannot be described
as a proper Prisma-deployed staging issuer, and is separately scheduled
for manual cleanup (issue #370). Its retained fake users/keys must never
be promoted to actual auth authority.

## What must be provided by the approved staging operator

A different, isolated **preproduction** Postgres database with its own
credentials and endpoint, ideally in a separately controlled Neon
preproduction project/branch, must be selected and independently identified
from the Neon control plane BEFORE configuring this command.

Do not derive a staging branch by cloning real production customer/PII
rows without an approved anonymization and retention decision. Never
target the current default production branch. Only an isolated empty,
fresh preproduction database may receive **official**
`prisma migrate deploy` from the separately approved operator.

The following generation-independent variables must be configured for the
readiness **process**. No actual values or secrets belong in GitHub source
or workflow-dispatch inputs:

```text
NODE_ENV=production
DEPLOYMENT_ENV=staging
APP_URL=https://<approved nonproduction DS origin>/
STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED=true
STANDALONE_STARTUP_POLICY_HTTP_ENABLED=true
PREPRODUCTION_ISOLATION_ACK=ISOLATED_STAGING_DATABASE
PREPRODUCTION_DATABASE_HOST=<approved exact nonproduction DIRECT host>
PREPRODUCTION_DATABASE_NAME=bke_preproduction
PREPRODUCTION_STARTUP_PRODUCT_ID=bke-render-dock
PREPRODUCTION_STARTUP_PRODUCT_VERSION=<approved published version>
PREPRODUCTION_AGENT_KEY_ID=<independently enrolled installed machine kid>
DATABASE_URL=<approved nonproduction pooled database URL>
DIRECT_DATABASE_URL=<approved nonproduction direct database URL>
ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON=<separately stewarded private keyset>
```

`PREPRODUCTION_DATABASE_NAME=bke_staging` is also supported only when
the host and database identity are independently selected and verified.
The CLI requires the pooled and direct connection URLs to resolve to the
same database and pinned direct endpoint host (allowing Neon's
`-pooler` DNS suffix). It refuses production-named databases, missing
human isolation acknowledgment, production DS origins, wrong flags,
missing expected product/version or machine key, and a test runtime.

Actual staging also must satisfy **all** current
`parseEnvironment` requirements: durable secrets, permitted configured
providers, an isolated distributed Valkey/Redis backend, properly pinned
deployment ID/prefix, and other protected-environment requirements.
This preflight does not replace those mandatory settings.

## Invoke the explicit read-only command

From the exact certified Digital Solutions source and **only after** the
operator independently validates the Neon project/branch/endpoint:

```bash
npm ci
npm run db:generate
npm run config:validate
npm run preproduction:startup:readiness
```

The readiness script does **not** run `prisma migrate deploy`,
`prisma migrate resolve`, `db:seed`, INSERT/UPDATE/DELETE/ALTER/CREATE
or any other mutation. It starts one PostgreSQL
`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, runs
bounded queries, then ROLLBACKs. It returns PASS only when:

1. Connected database **actually** matches the approved expected
   preproduction database, and no retained `bke_startup_mock_%`
   fixture schema is present.
2. Every official `_prisma_migrations` record matches **exactly**
   one checked-in `prisma/migrations/*/migration.sql` source filename,
   SHA-256 bytes and successful (nonrolled-back) application; neither
   missing nor extra/forged/partial rows pass.
3. Exactly one published, active and nonarchived SQL product +
   published Windows x64 STANDALONE release matches the approved
   product/version, with a persisted SQL `ACCOUNT`, `LICENSE_KEY`
   or `EITHER` activation mode.
4. Exactly one `ACTIVE` DS account-product Ed25519 signer exists,
   with an activated timestamp and matching `keyset:<kid>` reference,
   whose independently configured private key's derived public SPKI
   equals the canonical registered public SPKI.
5. The exact expected Agent installed machine key is SQL `ACTIVE`,
   has a valid immutable public-SPKI SHA-256 fingerprint, explicit
   Ed25519 or ES256 algorithm and verified SQL transition metadata,
   different ACTIVE ADMIN staging/activating actors, and both recorded
   staging/activation AuditLog actions bound to those actors.

The script prints **only** a sanitized readiness result plus
`human_approval=NOT_PROVEN installed_grant=NOT_PROVEN`.
It never prints credentials, private/public PEMs, machine KIDs, account
identities, database connection strings, SQL payloads or raw exceptions.

## Important evidence limitations

- The exact preproduction database **project, branch ID, endpoint and
  operator authorization must still be independently verified from the
  Neon/hosting control plane**. Checking a user-configured host and
  database name in the CLI is a valuable guard, but it is **not** a
  cryptographic Neon branch attestation.
- SQL actor IDs and AuditLog rows **alone** do not prove two genuine,
  independent authenticated people. Require real Google ADMIN sessions
  and reviewed machine fingerprint/possession evidence separately.
- A private/public signing-key match does **not** prove independent
  custody of the key, or physical TPM protected machine ownership.
- A successful preflight does **not** prove the staging deployment is
  reachable, that its endpoint has been explicitly enabled, that Agent
  sent a real installed attestation over HTTPS, that a real commercial
  LICENSE_KEY/ACCOUNT right was issued, or that Windows SYSTEM Agent
  made a positive process-bound authorization decision.

Those are separate, protected acceptance gates. Never merge test
fixtures or manually replayed SQL rows into genuine credential
authority. Do not dispatch the human-only Windows approval workflow or
activate production from this source-only readiness wave.
