# BKE Digital Solutions V2

V2 is the clean-room implementation of Digital Solutions under the BKE Modular Capability Architecture.

## Baseline doctrine

V1 history is already preserved on `legacy/v1`. V2 does not carry the old global Prisma migration journey forward merely because it exists.

```text
legacy/v1
  = V1 code + V1 Prisma + V1 migration history

live PostgreSQL
  = current structural, data, constraint, function and trigger truth

V2
  = reconstruct required truth by module owner
  = certify on fresh PostgreSQL
  = prove non-destructive equivalence
  = start new V2 migration history
```

## Shape

```text
v2/
├── apps/
│   ├── orchestrator/
│   └── web/
├── contracts/
├── modules/
├── platform/
│   ├── composition/
│   └── persistence/
└── tooling/
```

The orchestrator is deliberately dumb. It validates declared capability needs/providers, wires modules, starts them in dependency order, and exposes composed capabilities. Business logic and business persistence remain module-owned.

## Module rule

A production module owns its own `logic/`, `prisma/`, `contracts/` and `test/` surfaces. A module may consume another module only through an approved contract/capability. Direct imports of another module's logic, Prisma, tests or presentation internals are forbidden by `v2/tooling/check-module-boundaries.mjs`.

## Persistence rule

The Prisma isolation spike proved that raw independent Prisma migration directories still share the database-wide `_prisma_migrations` failure ledger. V2 therefore uses a thin mechanical compositor for physical migration execution while modules retain schema and migration intent.

## CI rule

Module-local changes run module-local certification. Public contract/manifest/composition changes widen to composition certification. The V1 whole-application CI no longer runs for V2-only file changes once the selective-CI scaffold is merged.
