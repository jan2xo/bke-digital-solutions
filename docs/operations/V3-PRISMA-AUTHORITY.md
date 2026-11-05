# Digital Solutions V3 — Central licensing, no software object storage

## Authority boundary

- **Digital Solutions** is the central licensing server and issuance authority.
  It validates customer rights; creates, signs, activates, renews, revokes and
  audits licenses/leases; and owns commercial entitlements, users and commerce.
  Software applications and the BKE Launcher are clients. They do **not**
  independently issue authoritative new licenses.
- **Neon/PostgreSQL via Prisma** stores business, product metadata, accounts,
  purchases, subscriptions, entitlements, licenses, activation/lease history,
  signing-key metadata, legal/compliance registers and audit records.
- **GitHub** owns public source, build validation, software release artifacts,
  executable packages, distribution links and product images. The catalog
  stores validated GitHub URLs and version metadata, not binary bytes.

## Retired components

Digital Solutions does not maintain package upload/download grants, malware
scanning, Supply Chain certification evidence, commissioning runs, stored
software package objects or an object-cleanup scheduler. Legacy upload APIs
are explicit HTTP 410 endpoints. Public GitHub availability does not confer
commercial usage rights; license grants remain enforced by Digital Solutions.

The unrelated Business Compliance Register remains active:
`ComplianceRequirement` and `ComplianceEvidence` record legal, privacy,
tax and accountable owner-review decisions, not software scanner results.

## Database migration and backups

The forward Prisma migration
`20261105180000_v3_business_only_retirement` verifies every retired
table is empty before dropping it, and refuses to proceed otherwise.
It also rejects populated legacy `ProductVersion` evidence columns before
dropping those obsolete fields.
This is a clean V3 staging assumption, not proof that any connected
database is empty. No migration has been run against a connected Neon DB.
Historical applied migrations remain immutable; do not rewrite them.

Optional encrypted PostgreSQL backups are deliberately **not** software
package hosting and must not be uploaded to public GitHub. They require
separate, private BACKUP_* storage and a restore target isolated from
the source. Legacy backups with binary objects cannot be silently
restored as database-only backups.

## Security and release

Do not alter license generation, signing, activation, entitlement, MFA,
payment, account or legal controls during storage retirement.
Review the exact-head PR diff and run required Intent CI before any merge.
This document does not authorize merges, migrations on live databases,
Staging/production deployments, or a production cutover.
