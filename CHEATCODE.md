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

### Ingest dependency evidence (production)

After generation reports `lockConsistency=PASS`, `resolution=PASS`, and
`audit=PASS`, ingest the actual document bytes through the authenticated admin
supply-chain workflow. Do not submit only a filename or local path.

From the production checkout, first obtain the server's current payload hash:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml exec -T postgres \
  sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT "canonicalPayloadHash"
FROM "SupplyChainEvidence"
WHERE "versionId" = '<VERSION_ID>';
SQL
```

Create a browser-ready request containing the exact generated file bytes. Run
this on the VPS; it prints no credentials, only the evidence request:

```bash
node - <<'NODE'
const fs = require("fs");
const path = ".supply-chain/<RELEASE_VERSION>/dependencies.json";
const b64 = fs.readFileSync(path).toString("base64");
console.log(`await fetch("/api/admin/supply-chain", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    versionId: "<VERSION_ID>",
    action: "RECORD_DEPENDENCIES",
    reference: "<PRODUCT>-<RELEASE_VERSION>.dependencies.json",
    evidenceHash: "<CURRENT_CANONICAL_PAYLOAD_HASH>",
    documentBase64: "${b64}"
  })
}).then(async r => ({ status: r.status, body: await r.json() }))`);
NODE
```

With an authenticated recent-admin session, open the production supply-chain
page, paste the generated request into the browser console, and require HTTP
200. The server verifies the document bytes and current payload binding; never
paste a stale hash or manually edit database evidence.

Verify the durable result:

```bash
docker compose --env-file .env.production \
  -f docker-compose.production.yml exec -T postgres \
  sh -c 'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT "dependencyStatus", "canonicalPayloadHash"
FROM "SupplyChainEvidence"
WHERE "versionId" = '<VERSION_ID>';

SELECT kind, result, "artifactHash", reference, "verifiedAt"
FROM "SupplyChainVerificationEvidence"
WHERE "evidenceId" = (
  SELECT id FROM "SupplyChainEvidence" WHERE "versionId" = '<VERSION_ID>'
)
AND kind = 'DEPENDENCIES'
ORDER BY "verifiedAt" DESC
LIMIT 3;
SQL
```

Expected: `dependencyStatus=VERIFIED`, a current-payload-bound
`DEPENDENCIES/VERIFIED` row, and a durable object reference. If the request is
rejected, preserve the response and do not mark the release ready.

SBOM and provenance generation are documented in
`docs/operations/RELEASE-SHIPPING.md`. Evidence ingestion and readiness remain
authenticated application operations; do not insert evidence rows manually.

For normal release certification, open
`/admin/releases/<version-id>` and use the Release Readiness controls. Upload
the actual Backup, Compliance, or Migration evidence document there; the server
computes the current payload hash, verifies the bytes, stores a private durable
evidence object, records the evidence/audit event, and refreshes readiness.
Signature and malware actions remain explicit protected actions. Approval is a
separate human decision and is never granted by uploading a document.

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
