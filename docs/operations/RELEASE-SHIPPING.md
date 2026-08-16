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
actual bytes through
`RECORD_SBOM` and `RECORD_PROVENANCE` at `/api/admin/supply-chain`. The server
stores durable evidence objects and rejects stale hashes, ephemeral references,
and missing documents. Use the corresponding authenticated evidence actions for
the other gates, sign only after current evidence is present, and never store
private keys in Git/PostgreSQL. Artifact mutation invalidates payload-bound
evidence and requires affected checks again.
