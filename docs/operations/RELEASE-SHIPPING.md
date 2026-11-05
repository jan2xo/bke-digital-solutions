# Release Shipping — Digital Solutions catalog consumer

## Current ownership

Software repositories and their GitHub Actions workflows own builds, malware
scanning, checksums/signing where required, and distribution through GitHub
Releases. **Digital Solutions is not a Supply Chain executor or certifier.**
Retired admin scan/evidence pages and generators are not part of the shipping
workflow. Legacy artifact and evidence mutation endpoints return HTTP 410
instead of uploading, signing, commissioning, or modifying stored packages.

The Digital Solutions admin release catalog records a product's semantic
version, operating-system/architecture metadata, lifecycle and visibility.
An authenticated, recently verified admin advances lifecycle or changes
catalog publication. DRAFT and unpublished versions are not customer-visible.

Version details link to the exact mapped GitHub tag `v<version>`, not
automatically to the latest tag. The mapped product repositories are in
`platform/distribution/github-releases.ts`; unknown products have no
fabricated distribution URL. The license-bound customer download route retains
its existing active-license, account/access, expiration, email verification,
legal acceptance, and rate-limit controls before redirecting to a mapped
GitHub release. This does not make a private GitHub repository publicly readable.

## Product images and existing data

Product images use validated HTTPS `raw.githubusercontent.com` raster URLs
from approved `jan2xo` repositories. The server stores the reference in
existing `Product.imageKey`; it does not upload image bytes. Replacement,
deletion and backup operations distinguish valid GitHub URLs from legacy
server-owned product image object keys. Old stored objects and historical
database records are not rewritten or erased.

## Separate commercial security

Digital Solutions retains licensing key generation and discovery, signed
commercial leases, entitlements, account/session/MFA controls, payment and
independent backup/restore responsibilities. These are **not** the retired
Supply Chain signing/evidence subsystem. Do not remove their keys, providers,
validation, authorization, or persistence.

## Source certification and release boundary

Use the existing Intent CI on the exact cleanup PR head, including repository
security, runtime tests, TypeScript checks, ordinary build and deployment
contract checks. Tests of actual GitHub catalog links, product image
validation, and legacy 410 endpoints accompany the normal core suite.

This document does not authorize deployment, DNS changes, production
operations or PR merging. The Prisma schema, migration history and generated
clients remain unmodified.
