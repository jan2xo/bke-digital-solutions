# External software version model

Automated artifact intake, technical certification, SBOM generation,
dependency analysis, provenance, malware scanning, commissioning, and
supply-chain evidence are deferred architecture.

The active software model is deliberately small:

- `Product` owns the canonical product identity and accepted-version policy.
- `ProductVersion` owns the version and an administrator-configured
  `externalUrl`.
- The catalog displays the product and its active version policy.
- An authenticated, entitled customer may use Download; BKE authorizes the
  request and redirects to the configured external URL.
- Installer bytes never transit BKE and no object-storage artifact is needed
  to publish a software version.

## Render Dock cleanup procedure

This procedure is intentionally not executed by development workers. Run it
only after reviewing the dry-run output against production records.

1. Back up the database and run the inventory queries below in a read-only
   session.
2. Confirm the exact product row is `productId = 'bke-render-dock'` and keep
   that `Product` row, its editions, plans, licenses, assignments, and audit
   history.
3. Target only Render Dock versions `1.0.1` and `1.0.2` that are `DRAFT`, not
   active, unpublished, and have no configured external URL. Treat any row
   failing those predicates as preserved until separately reviewed.
4. Review the counts and identifiers. If any targeted version is referenced
   by a customer-facing state or has become published/active, abort.
5. Delete only the enumerated disposable version rows, in a transaction, and
   retain the canonical product and all licensing/commerce records.

Dry-run inventory:

```sql
SELECT p.id, p."productId", p.name, v.id AS version_id, v.version,
       v.lifecycle, v.active, v."publishedAt", v."externalUrl"
FROM "Product" p
JOIN "ProductVersion" v ON v."productId" = p.id
WHERE p."productId" = 'bke-render-dock'
  AND v.version IN ('1.0.1', '1.0.2');

SELECT v.id AS version_id, v.version, v.lifecycle, v.active,
       v."publishedAt", v."externalUrl"
FROM "Product" p
JOIN "ProductVersion" v ON v."productId" = p.id
WHERE p."productId" = 'bke-render-dock'
  AND v.version IN ('1.0.1', '1.0.2')
  AND v.lifecycle = 'DRAFT'
  AND v.active = false
  AND v."publishedAt" IS NULL
  AND v."externalUrl" IS NULL;
```

The schema migration intentionally leaves the obsolete artifact-era tables
and historical rows dormant because production migration risk is higher than
the benefit of deleting them in this pass. They are not queried by the active
product/version/download flow, and no new rows are created. The optional
post-migration cleanup above is limited to failed Render Dock draft versions;
upload-session counts from the old schema must be recorded before migration
if an operator needs them in the cleanup report. A later bounded migration
may drop the dormant tables after production inventory and backup review.
