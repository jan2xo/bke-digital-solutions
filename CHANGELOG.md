# Changelog

## Unreleased

### Production self-hosted MinIO bootstrap remediation

- Recorded the fresh-VPS failure where MinIO was healthy but the private application bucket and application identity were not initialized deterministically.
- Added bounded, idempotent `minio-init` bootstrap with private bucket creation, dedicated bucket-scoped credentials, exact direct-policy enforcement, and fail-closed rejection of broader direct permissions and inherited/group permissions.
- Kept MinIO as private primary storage and Cloudflare R2 as the separate encrypted offsite-backup destination.
- Added runtime integration regression coverage that executes the real initializer against disposable MinIO/`mc` infrastructure and verifies production Compose credential separation.
- Certified MinIO integration 5/5, certification Vitest 178 passed with 6 credential-gated skips, Playwright 11/11, TypeScript, ESLint, Prisma validation/generation, production build, Compose validation, repository hygiene, and `git diff --check`.

VPS deployment, production secrets, and cold-reboot certification remain pending owner-controlled Phase 6.10 work.
