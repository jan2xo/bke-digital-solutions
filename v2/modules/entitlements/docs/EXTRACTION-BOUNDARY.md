# Entitlements extraction boundary

## Objective

The certified V2 Entitlements durable-right capability is a staging source for the standalone `@bke/entitlements` library. Extraction moves reusable durable-right ownership without moving Digital Solutions composition or introducing product-specific enforcement.

## WHAT I NEED

Entitlements receives opaque subject/resource/source references plus scope, grant evidence, quantity, and validity through its own contract. The caller is responsible for establishing that the source fact is authorized. Entitlements does not decide Payment success and does not own Accounts, Commerce, Legal, Licensing, Distribution, or Payment persistence.

## WHAT I DO / WHAT I OWN

Entitlements owns exactly:

- `Entitlement`
- `EntitlementStatus`
- `bke.entitlements.durable-right-grant.v1`
- durable-right input validation and normalization
- idempotent grant semantics through unique `sourceReference`
- source-conflict rejection
- Entitlements-local status, scope, grant evidence, and validity

The staging migration `prisma/migrations/0001_entitlements_durable_right_baseline/migration.sql` is package-owned migration content. Physical extraction maps it to `@bke/entitlements/migrations/0001_entitlements_durable_right_baseline/migration.sql` and must preserve it byte-for-byte.

## WHAT I GIVE

Entitlements gives a transport-neutral durable-right grant capability. Consumers may use the returned Entitlement through their own contracts. A software consumer may later feed an Entitlement into Licensing; Distribution may authorize delivery from an Entitlement; SaaS may consume it directly. None of those enforcement/delivery policies belong in this package.

## Package-owned source set

Move to `@bke/entitlements`:

- `contracts/`
- `logic/`
- `prisma/schema.prisma`
- `prisma/repositories/`
- package-owned tests from `test/`
- `module.manifest.ts`
- `prisma.config.ts`
- `docs/`
- the Entitlements baseline migration

## Host-owned source set

Do not move as Entitlements business implementation:

- `module.ts` — Digital Solutions composition adapter
- `test/module-composition.test.ts` — host composition proof
- HTTP / Next.js routes
- authentication/session transport
- Checkout orchestration
- Payment settlement decisions
- Licensing/runtime enforcement
- Distribution/download authorization

## Extraction gate

Before physical extraction:

1. package-owned source passes `test/extraction.certify.ts`;
2. disposable PostgreSQL passes `test/persistence-isolation.certify.ts`;
3. durable-right behavior and idempotency remain GREEN;
4. Digital Solutions Composition remains GREEN on the same candidate head.

Physical extraction then proves the standalone package independently before Digital Solutions consumer adoption. Staging deletion happens only after package certification and package-backed consumer composition are GREEN.
