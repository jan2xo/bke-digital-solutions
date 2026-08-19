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

BKE Digital Solutions 1.0 operates under a sole-owner authority model. The
authenticated owner/admin may review and approve the same release; a second
administrator is not required. This authority satisfies only the human Approval
gate. All machine-enforced readiness, payload, legal-version, malware, signing,
and supply-chain controls remain mandatory and are independently revalidated at
promotion and publication. Multi-authority separation is future governance work,
not a current launch prerequisite.

The Compliance Register has a separate owner-completion step: record immutable
evidence first, then use **Mark Implemented** after the authenticated Owner/Admin
confirms the review or owner decision. Evidence alone never completes a
requirement; the completion action is recent-authenticated, same-origin,
rate-limited, audited, idempotent, and reduces the release gate's pending count.

Approval and publication are payload-bound. A reviewer records review for the
current canonical payload, then a different recent-authenticated administrator
records approval for that same payload. Historical approvals without a payload
hash are stale. Artifact mutation invalidates the approval through the payload
comparison; historical rows remain for audit. Every request that publishes or
promotes to STABLE/LTS recomputes all readiness gates server-side and requires
current approval; `published=true` alone is not a publication bypass.

Commercial compliance evidence must use the structured
`bke.compliance-certification.v1` envelope with `classification: "COMMERCIAL"`,
the target version and current payload hash, legal-document references, the
authenticated certifying administrator, and complete required assertions. `MOCK` evidence is
retained for testing but never satisfies commercial readiness. The server
validates structure, binding, and classification, not the legal merits.

For the normal Admin-native commercial workflow, open `/admin/releases/<version-id>`,
review the authenticated certifier identity, optionally enter a review scope, and acknowledge the required
assertions, and select **Certify Compliance**. The server resolves the active
published legal-document versions, computes the current payload hash, stores the
validated document in private object storage, and records an audit event. This is
an explicit human attestation; it is not legal advice or an automatic legal
approval. A later legal-version or artifact change makes the prior evidence
ineligible until recertified.

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

For Backup certification, complete the real backup, `VERIFY`, and
`SIMULATE_RESTORE` workflow first, then export the truthful release-bound
document with:

```bash
npm run supplychain:backup-evidence -- <version-id> <backup-id>
```

This exporter only reads existing archive/operation/release records. It fails
closed unless the selected archive is `VERIFIED`, has zero missing objects and
required checksums/references, and has successful CREATE, VERIFY, and
SIMULATE_RESTORE operations belonging to that archive. Upload the result using
the Admin Release Readiness BACKUP control.

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

For BACKUP certification, first complete one genuine backup followed by
VERIFY and SIMULATE_RESTORE. Then open the target release's Admin Release
Readiness page, select an archive whose status is `VERIFIED`, and choose
**Certify Backup for Release**. The server reconstructs the certification
document from persisted archive/operation facts, binds it to the current
payload, and records durable BACKUP evidence. The CLI exporter remains a
read-only diagnostic alternative.

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
