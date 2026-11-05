# V3 held integration candidate

This source assembly reuses existing intents without merging or deploying: security PR269 at 0bcdddc6612b53ec30a87c4194e1ce9f9df9aa11; Supply Chain consumer retirement PR273 at 9094b53cc9c27a26357258ed3f6868eb64ee104b; business-only database PR274 at 17085d124d354d6415122719eb1e205a1c1cee39; Google-only policy PR267 at a91d2cd7c7c03d9d9e0dfdf369cadeedc11007ba; Workers baseline PR266 at b808245f90cb244862ac8edc505b851e952540f1. Main remains a36d9decffa6936114a9578857558a9687ca4e7f until separately approved integration.

The final schema contains 67 models: business/licensing authority and GoogleIdentity, with the eight retired artifact/storage/release models removed. Both approved forward migrations remain unchanged and ordered. Shared Identity remains the immutable 0.5.0 release, including historical package-owned structures required by other consumers. No live database is modified by source assembly.

Security dependency choices are copied from reviewed PR269: Prisma client/adapter/CLI7.10.1, Next16.4.5, Zod4.6.7 and its security overrides. Preserve OpenNext1.20.15, Wrangler4.157.0 and the Workers lint configuration. Do not splice npm lock integrity or generated Prisma internals.

## Disposable generation and verification

The existing CI workflow has a read-only push path restricted to the single integration branch. It uses pinned official checkout/setup/upload Actions, verifies the exact pushed source, regenerates the npm lock and normalized Prisma client on Actions, and uploads only public source plus provenance. It has no repository write, deployment, OIDC or protected environment access. PR270's privileged dispatcher stays parked.

A successful generation job means only that review artifacts were produced. Inspect its successful job, exact source and artifact provenance, retain the unchanged manifest/schema, then commit the authentic lock/client. On subsequent branch pushes, generation must produce no diff before the existing workerd receiving proof runs. The ordinary core certification gates remain unchanged for manual/reusable invocation. Push generation is not full certification; protected deployment still requires its existing workflow-dispatch inputs, core gates and environment review.

Use the existing /certify intent for exact-head core/module checks; the trusted default-branch caller uses main workflow definitions. Keep branch-defined Workers proof separate and record both source and workflow provenance. Host/composition may need sequential requests because the trusted main definitions share a concurrency group.

## Receiving boundaries and remaining checklist

- [x] Preserve central account, business, entitlement, licensing/signing and activation ownership.
- [x] Keep public product images and distributable artifacts on GitHub.
- [x] Carry the Google-only policy without restoring password/MFA/email login.
- [x] Preserve Worker operation-scoped clients and Node/Docker fallback lifetime.
- [ ] Inspect and commit Actions-generated lock and complete normalized Prisma client.
- [ ] Pass exact-head core, module, security and actual workerd receiving checks.
- [ ] Execute retirement refusal, lock-contention and rollback tests against disposable PostgreSQL.
- [ ] Execute the retained browser business scenarios in their validated disposable environment.
- [ ] Implement/certify Cloudflare primary business email with Resend fallback through the existing provider boundary; neither is an authentication dependency.
- [ ] Observe real Google sign-in and signed auth_time availability. Protected actions stay locked without valid fresh proof.
- [ ] Verify Workers Paid effective settings/cold-warm resource use and installed Agent/Launcher behavior separately.
- [ ] Verify private encrypted database backup execution through a Node-capable path; Worker source does not provide pg_dump/pg_restore.
- [ ] Obtain separate integration/merge and deployment authority.

No production authentication cutover, apex/DNS change, deployment, paid-resource change or connected Neon deletion is authorized.
