# Phase 4 — Platform Administration Layer

The platform administration layer replaces normal Prisma Studio operations with secured web tools. It reuses the existing database, authentication, global administrator role, server-side authorization, Zod boundaries, audit records, storage provider, email outbox, and commerce state models.

Administration routes are grouped under `/admin`; mutations are grouped under `/api/admin`. Server components perform read queries, while small client components submit same-origin mutations and refresh server data. No public-site redesign or parallel commerce system was introduced.

Operational centers cover products, releases, artifacts, customers, licenses, devices, orders, invoices, and audit events. High-impact operations are explicit, audited, and confirmation-gated in the UI. Payment redirects still cannot mutate payment state; refunds remain webhook-driven.

Phase 4.1 completes the product lifecycle: archived products can be restored or, only when a server-side evaluator finds no customer or historical dependencies, permanently deleted using typed-name confirmation. Success and blocked attempts are audited, exclusive private objects/child rows are cleaned safely, and there is no force-delete path. See the dedicated Phase 4.1 report.

Current security caveats: administrator MFA/recent-auth should precede production one-time license disclosure, and large audit exports should become background jobs. See the detailed report under `docs/phase-reports/`.
