# Production dependency-security remediation — execution acceptance

**Status:** DELEGATED TO FORGE / IMPLEMENTATION PENDING. **Production: LOCKED.**

## Authority and baseline

- Source repository: `jan2xo/bke-digital-solutions`.
- Starting `main`: `a36d9decffa6936114a9578857558a9687ca4e7f` (reverify before implementation and certification).
- Independent branch: `fix/v3-production-dependency-security`.
- Blocking finding: [exact-branch PostgreSQL readiness CI 41665576351](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41665576351) on PR #268, HEAD `c27517d1a85a2b5fb2056dcb8419d5e2673821e6`, reported **9 high and 1 critical production dependency audit findings**. The command `npm audit --omit=dev --audit-level=critical` failed, blocking required core certification.
- PR #268 remains Forge's checkpointed PostgreSQL readiness foundation, in independent review and **unmerged**. Sol retains PR #267 Google-only OAuth integration and PR #266 Workers composition, both independent.
- Existing `main-v3-legacy` snapshot must remain unchanged.

## One engineering intent

Fix the verified production dependency advisories with the smallest compatible, reproducible, independently reviewable manifest/lockfile update. This PR must **not** absorb PostgreSQL, Google OAuth, Workers runtime, application feature work, schema redesign, or production configuration.

The observed baseline declares Next.js `16.3.6`; Prisma CLI/client `7.9.1`; overrides include `sharp=0.35.3` and `fast-uri=3.1.5`. Audit findings also mention `deepmerge-ts`, `mysql2`, `source-map-js`, and `zod`. These are **investigation leads**, not blanket authorization to upgrade everything. Determine which transitive paths are actually in the **production install tree** and which updates affect Prisma engine/runtime or Next.js production behavior.

## Execution requirements

1. Revalidate `main`, candidate branch, package manifest/lockfile, source SHA, and full current advisory set. Inventory each finding, its dependency path and fixed ranges before changing dependencies. Do not assume a single patched Next.js version closes every critical/high finding.
2. Select the minimum compatible direct dependencies, transitives and overrides. Keep `@prisma/client`, Prisma CLI, and adapter versions compatible. Do **not** blindly invoke `npm audit fix --force`; do not suppress or weaken security checks. Do not handcraft `package-lock.json`.
3. Generate genuine lockfile bytes with npm in a **disposable GitHub Actions Node 22 environment**, using controlled workflow-dispatch inputs and pinned test commands. Prefer a manual candidate-branch workflow with explicit exact `source_sha` and validation. Do not accept arbitrary shell commands or untrusted version strings as workflow inputs.
4. If a narrowly scoped GitHub Actions job is used to commit the generated patch, require explicit `permissions: contents: write`, a verified target branch `fix/v3-production-dependency-security`, exact-head checkout and pre-push compare-and-swap/lease validation, and no push on failed validation. Do not assume the configured `GITHUB_TOKEN` has write permission. If it does not, produce a verifiable CI artifact and use an authorized GitHub connector write path for the **reviewed exact bytes**. No long-lived personal tokens or secrets in chat.
5. Verify fresh-install reproducibility: `npm ci`, production `npm audit --omit=dev --audit-level=critical` and preferably `--audit-level=high`, lint, TypeScript, Prisma generate/schema/migration replay as affected, full relevant `core` runtime/build/container graph, and specific Next.js/Prisma regressions. Do not call a green partial job a passing required graph.
6. Document every remaining production high or critical advisory, fix/mitigation rationale and applicable affected version. Preserve existing signing, checkout, licensing, Node/Docker fallback and security-sensitive request behavior. Do not force application feature changes into the security PR.
7. Request independent review against the **new exact HEAD**. Record certification plan, workflow revision, executed commands, run IDs, pass/fail counts, advisories remaining, dependency diffs and artifact/source hashes in PR comments.

## Safe acceptance and locks

- Source and generated lockfile are consistent; a clean `npm ci` succeeds.
- Required production-dependency audit no longer fails. Any unresolved high findings are explicitly adjudicated; no false clean bill of health.
- Minimum complete exact-head CI graph **PASS**, including build/runtime and relevant integration checks, without skipped required tests.
- Independent reviewer accepts this **security intent** only. This does not certify PR #268's remaining app-level PostgreSQL gates, Sol's Google sign-in, Workers Free limits, Hyperdrive, native receiving flows, provider readiness or production launch.
- **No merge, auto-merge, provider provisioning, paid activation, deployment, production secrets, credentials, production DB changes, or changes to PR #266/#267/#268 branches.**

**Owner:** FORGE is the only worker assigned to this security PR after checkpointing PR #268. One worker instance → one active PR writing assignment.
