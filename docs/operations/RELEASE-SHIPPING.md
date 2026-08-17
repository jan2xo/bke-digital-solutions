# Release Shipping

Use the authenticated admin workflow for one ProductVersion. The gate is:

`artifact SHA-256 → CLEAN malware → SBOM → provenance → dependencies → migration
→ backup → compliance → signature → reviewer/separate approver → STABLE →
private authenticated download`.

The automation/read-only boundary is deliberate: `supplychain:evidence` only
generates bytes, and `ops:health`/`ops:validate` only verify deployment state.
Authenticated evidence ingestion, signing, reviewer approval, lifecycle
transitions, and publication remain explicit operator/admin actions.

The normal operator path is the Admin Release Readiness page at
`/admin/releases/<version-id>`. It displays current payload-bound readiness and
provides server-backed scan/sign actions plus evidence-document upload for
Backup, Compliance, and Migration. The server computes the payload hash,
verifies and durably stores document bytes, and refreshes readiness; operators
do not need DevTools, PostgreSQL queries, or manually supplied `evidenceHash`.
Approval remains an explicit human action and cannot be fabricated by upload.

Generate the complete local evidence package with:

```bash
npm run supplychain:generate -- <version-id> [output-directory]
```

This fail-closed command produces `sbom.cdx.json`, `provenance.json`,
`dependencies.json`, and `migration-status.txt`. It reuses the existing
generators, runs real dependency analysis, executes `prisma migrate status`,
and reports exact document hashes. It never ingests evidence or changes
readiness. Upload the generated files from the Admin Release Readiness page.
Backup and Compliance remain independently evidence-driven; Approval remains a
human authorization.

Generate both documents reproducibly with
`npm run supplychain:evidence -- <release-version> [output-directory]`. The
command writes a version-scoped local evidence directory and reports the exact
file hashes; it does not mutate production or record trust. Alternatively, run
the individual generators when a separate output is required. Then submit the
actual bytes through `RECORD_SBOM` and `RECORD_PROVENANCE` at
`/api/admin/supply-chain`. The server stores durable evidence objects and
rejects stale hashes, ephemeral references, and missing documents. Use the
corresponding authenticated evidence actions for the other gates, sign only
after current evidence is present, and never store private keys in Git/
PostgreSQL. Artifact mutation invalidates payload-bound evidence and requires
affected checks again.

Generate dependency evidence with:

```bash
npm run supplychain:dependencies -- 1.0.0 .supply-chain/1.0.0/dependencies.json
```

The command copies only `package.json` and `package-lock.json` into a disposable
temporary workspace, runs `npm ci --ignore-scripts`, then runs `npm ls` and
production `npm audit` against that isolated installation. The machine-readable
result records package-lock SHA-256/format, resolved state, and audit output. A
non-zero result means dependency certification is incomplete;
do not record it as VERIFIED. Ingestion remains an authenticated admin action:
submit the file bytes with `action=RECORD_DEPENDENCIES`, a durable reference,
and the current server-computed payload hash.

## Manual / diagnostic equivalent

**MANUAL / DIAGNOSTIC EQUIVALENT — NOT THE DEFAULT OPERATOR PATH**

This preserves the expanded sequence used during production certification. It
uses `/tmp` only as a transient diagnostic workspace; durable evidence must be
ingested from the actual bytes through the authenticated workflow above.

```bash
cd ~/bke-digital-solutions

export RELEASE_VERSION=1.0.0

export SBOM_OUTPUT=/tmp/bke-institution-suite-1.0.0.sbom.cdx.json
npm run supplychain:sbom
sha256sum "$SBOM_OUTPUT"

export GIT_COMMIT=$(git rev-parse HEAD)
export GIT_BRANCH=$(git branch --show-current)
export BUILD_ENVIRONMENT=production
export BUILDER_IDENTITY=bke-production-vps
export PROVENANCE_OUTPUT=/tmp/bke-institution-suite-1.0.0.provenance.json

npm run supplychain:provenance
sha256sum "$PROVENANCE_OUTPUT"

echo "COMMIT=$GIT_COMMIT"
echo "BRANCH=$GIT_BRANCH"
```

The relationship is:

- **AUTHORITATIVE OPERATOR COMMAND:**
  `npm run supplychain:evidence -- <release-version> [output-directory]`
- **MANUAL/DIAGNOSTIC EXPANSION:** the explicit environment-variable and
  generator sequence above.
