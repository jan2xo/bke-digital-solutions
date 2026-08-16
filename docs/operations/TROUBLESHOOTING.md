# Troubleshooting

| Symptom | Cause/diagnosis | Safe fix | Status |
|---|---|---|---|
| UI route 404 | stale image or wrong commit | verify image/commit, rebuild, run route verifier | deployment issue |
| destructive action denied | `ALLOW_DESTRUCTIVE_ADMIN=false` | owner-controlled setting only when intended | guarded |
| scanner UNKNOWN/UNAVAILABLE | missing env or private connectivity | verify `MALWARE_SCANNER_*`, ClamAV, and network | fail closed |
| `OBJECT_READ_FAILED` | DB object key absent in MinIO | reconcile replacement lifecycle | integrity incident |
| EICAR generic HTTP 400 | infected scan rejected by design | inspect evidence; do not weaken gate | UX parked |
| SBOM hash mismatch | bytes differ from recorded hash | regenerate and ingest exact bytes | fixed |
| ephemeral evidence reference | local path/filename is not proof | submit document bytes through ingestion | rejected |
| readiness missing/stale | current payload lacks evidence | run affected evidence workflow | fail closed |
| canonical hash mismatch | evidence belongs to old artifact set | recompute and re-ingest | fail closed |
| deployment preflight fails | Compose/topology/restart policy mismatch | run `npm run ops:validate -- .env.vps`, correct config, and rerun | stop deployment |
| health check fails | service or dependency is unhealthy | run `npm run ops:health -- https://production-host`, then inspect Compose health/logs | stop traffic |
| scheduler healthcheck fails | scheduler process stopped, app route unavailable, or durable job state is stale | inspect scheduler logs and `/api/health/scheduler`; restore dependencies and let the worker recover | stop relying on scheduler |
| backup worker recovery is uncertain | worker has no HTTP health contract; durable operation state or restart is unhealthy | inspect `BackupOperation`, worker logs, and restart policy; do not add a fake probe | stop backup claims |
| manifest validator rejects Caddy domain | verifier expected one obsolete token spelling | run current `npm run ops:validate -- .env.production`; validator accepts supported environment-token wiring | fixed |
| dependency evidence generation fails | lockfile, resolution, or audit is not certifiable | preserve the JSON result, correct dependency state/network, and rerun | do not record VERIFIED |

For compromise, payment abuse, credential exposure, or data loss, follow
[incident response](../runbooks/incident-response.md). Do not delete volumes,
rotate keys blindly, or publish around a blocked predicate.
