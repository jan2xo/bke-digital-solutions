# BKE Operations Cheatcode

This is a quick reference for repeatable, documented production operations.
Authoritative procedures live in `docs/operations/`; use those runbooks for
full prerequisites, failure handling, rollback, and verification.

## Core validation

Run from the repository checkout:

```bash
npm run ops:validate -- .env.production
npm run ops:health -- https://<production-host>
npm run deployment:verify-manifest
npm run deployment:verify-restart
```

These commands are read-only validation. A failed result is a stop condition;
do not bypass the validator or change production merely to obtain a pass.

## Trusted-release evidence

The default operator command is:

```bash
npm run supplychain:evidence -- <release-version> [output-directory]
```

For dependency certification specifically:

```bash
npm run supplychain:dependencies -- <release-version> [output-file]
```

Dependency generation uses a disposable manifest-only workspace, runs
`npm ci --ignore-scripts`, then `npm ls` and production `npm audit` against
that installed tree. It must not rely on pre-existing checkout `node_modules`.
Do not record dependency evidence as VERIFIED unless lock consistency,
resolution, and audit all pass.

SBOM and provenance generation are documented in
`docs/operations/RELEASE-SHIPPING.md`. Evidence ingestion and readiness remain
authenticated application operations; do not insert evidence rows manually.

## Deployment and recovery

Use the canonical procedures:

- `docs/operations/FRESH-VPS-BOOTSTRAP.md`
- `docs/operations/PRODUCTION-DEPLOYMENT.md`
- `docs/operations/DISASTER-RECOVERY.md`
- `docs/operations/BACKUP-RESTORE.md`
- `docs/operations/SIGNING-KEY-RECOVERY.md`

Do not expose secrets in commands or logs. Keep private services on their
private Docker networks and verify health after every approved mutation.

## Command-recording policy

Every safety-sensitive command used for deployment, certification, restore,
shipping, or recovery must be either:

1. an authoritative repository script/task; or
2. an explicitly documented manual equivalent with prerequisites, inputs,
   expected output, failure behavior, rollback, and verification.

AI chat history and shell history are not operational records. One-off
exploratory grep/debug commands are not authoritative unless promoted into a
known troubleshooting procedure. See `docs/operations/COOKBOOK.md` for the
operator-facing index.
