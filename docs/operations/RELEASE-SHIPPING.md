# Release Shipping

Use the authenticated admin workflow for one ProductVersion. The gate is:

`artifact SHA-256 → CLEAN malware → SBOM → provenance → dependencies → migration
→ backup → compliance → signature → reviewer/separate approver → STABLE →
private authenticated download`.

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
