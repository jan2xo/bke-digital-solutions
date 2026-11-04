# BKE Digital Solutions — two coding agents and one reviewer

Verified snapshot: 2026-11-04, Asia/Manila. Canonical repository: https://github.com/jan2xo/bke-digital-solutions. Recheck GitHub before every consequential action; the snapshot below is not permission to rely on a stale branch.

## Operating model

The owner has two coding agents. **Sol, in this chat, is now the reviewer.** The coding agents implement their assigned intents and provide exact-head evidence. The owner forwards their findings, self-assessments and engineering decisions to Sol for independent review.

This supersedes older handoffs that directed this chat to resume its internal coding subagent. Use the owner's existing agents and selected models. Do not create another worker layer or assume that a coding agent's own verdict is independent acceptance.

Sol verifies canonical source, diffs, callers, security/authority boundaries, architecture, scope and CI evidence, then returns **ACCEPT_SOURCE_ONLY**, **REMEDIATE**, or **BLOCKED** against an exact head. Source acceptance is separate from owner merge authorization, configured-provider acceptance, installed-native acceptance and production release.

## Verified starting points

Default branch is `main`, currently `a36d9decffa6936114a9578857558a9687ca4e7f`. All application PRs below are open drafts and unmerged at this snapshot.

| Intent | PR / branch | Exact head |
|---|---|---|
| Workers compatibility proof | [266](https://github.com/jan2xo/bke-digital-solutions/pull/266), `feat/workers-free-compatibility-proof` | `d191f925025377682ffe82bfbd63e321a5542f41` |
| Google-only consumer | [267](https://github.com/jan2xo/bke-digital-solutions/pull/267), `feat/google-only-auth-consumer` | `50d483350736c22d887a01cb23fb30de57a97107` |
| PostgreSQL readiness / integration contract | [268](https://github.com/jan2xo/bke-digital-solutions/pull/268), `feat/v3-postgresql-readiness` | `c27517d1a85a2b5fb2056dcb8419d5e2673821e6` |
| Dependency-security remediation, FORGE-owned | [269](https://github.com/jan2xo/bke-digital-solutions/pull/269), `fix/v3-production-dependency-security` | `086d473264fece6342a83330621d7e2967f1aa5e` |
| Trusted dependency-generator comment dispatcher | [270](https://github.com/jan2xo/bke-digital-solutions/pull/270), `ci/security-generate-comment-dispatcher` | `6e41efe2543a03ddf8ca5bdf8a5d21590a43f280` |

The migration roadmap, checkout plan and this coordination handoff belong to [documentation PR271](https://github.com/jan2xo/bke-digital-solutions/pull/271). Fetch its current head when using it.

Shared library [Identity 0.5.0](https://github.com/jan2xo/bke-libraries-typescript/releases/tag/identity-v0.5.0) is already released. The tag resolves to `a8590377f913a5ce8802fca5cdaf562ad8d4ff7e`. Its immutable tarball SHA-256 is `d78e365d2db23044fe1175114affb540823599380c5dda85042dfe8073e1a2b9`. Do not republish or replace that version. The owner's authorization to release library PR85 did not authorize application or dispatcher merges.

## Existing evidence and its limits

- PR267 has independent **ACCEPT_SOURCE_ONLY** at `50d4833...`. That verdict applies only to the reviewed source and does not carry automatically to a new head.
- [Run243](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41750739996), source/workflows `e18754f5ac9aff2f4d659181470e42c45e5ff01e`: Identity, lint/typecheck/application build, Docker/contracts, PostgreSQL/schema/migrations/runtime and native-account jobs passed. Runtime: **733 passed, 5 skipped**. Native target: **79 passed**. Full required certification failed the production dependency audit. Composition/host were cancelled by a shared concurrency group.
- [Run245](https://github.com/jan2xo/bke-digital-solutions/actions/runs/41751480399), exact `50d4833...`: **composition, host and all six Prisma-isolation scenarios passed**. The parent-to-current delta was only three workflow concurrency names; application, tests, core, Identity and native-account workflow bytes were unchanged. This scoped green run is not a full/core security pass.
- The production audit still reports **9 high and 1 critical finding**. Current PR269 has generator/guardrail work, with no package manifest/lockfile remediation in its diff yet. It is not cleared by an unrelated green workflow.
- PR270's current body reports exact-head behavioral/actionlint/build evidence at `6e41efe...` and run `41745431014`. **That new dispatcher candidate has not been independently reviewed by Sol in this handoff.** Its command is not active on current main. Verify its actual jobs and policy code before accepting those claims.
- PR268 provides a readiness foundation and connection contract. Its protocol tests do not establish application-level Hyperdrive behavior, provider provisioning, restore acceptance or production readiness.
- PR266 currently has the compatibility acceptance document, with **no committed Worker application implementation**. Actual Workers runtime/resource acceptance is pending.
- Real Google/Redis configuration, actual Google sign-in, installed Agent/Launcher behavior, sensitive native feature availability and production operation are unverified.

Canonical consumer evidence: https://github.com/jan2xo/bke-digital-solutions/pull/267#issuecomment-6619735373

## Coding agent 1 — security and CI owner

Continue the existing FORGE-owned security/CI intent. Keep PR268 checkpointed; do not expand its database scope opportunistically.

1. Reconcile the latest PR270 head and submit its review package to Sol: exact base/head, diff, privilege model, behavioral tests, actionlint and genuine workflow-definition provenance. Await review disposition and separate owner authorization before any merge/activation. Prepare only corrections supported by concrete findings.
2. Preserve the controller boundary: trusted default-branch policy only, fixed repository/PR/branch/workflow/inputs, verified owner/write authority, exact live head/ref agreement, no candidate-code execution under dispatch permission, no contents-write capability and no arbitrary commands. Check duplicate suppression, queued jobs without visible rows, artifact reuse independent of unrelated CI failure, and positive generator-run attribution.
3. Once its prerequisite and authorization are satisfied, continue PR269 using genuine npm-produced manifest/lockfile output and verified artifacts. Do not hand-edit the lockfile, blindly force audit fixes or lower the audit threshold.
4. Verify a clean install, required production security audit, relevant high findings, compatibility and exact-head core evidence. Report the first causal error for any failure.
5. Submit the dependency candidate and any integration decisions to Sol. Preserve Google, PostgreSQL, licensing and Workers behavior. No new source of authority or infrastructure is justified by dependency repair.

Until an explicit handover, this agent is the sole implementation owner of dependency-remediation edits to `package.json`/`package-lock.json` and the shared CI/generator infrastructure. Other agents must coordinate required changes to those files rather than write competing versions.

## Coding agent 2 — Google integration and Workers owner

Preserve PR267's accepted application source while preparing the migration in PR266. Declare the proposed branch/base and dependency checkpoint before changing it; do not assume PR267, PR268 or security work is already on main.

1. Read PR271's `CLOUDFLARE-MIGRATION-PLAN.md` and PR266's `CLOUDFLARE-COMPATIBILITY.md`. Use PR268's PostgreSQL integration contract as a proposed seam, retaining its explicit unproven boundaries.
2. Coordinate the dependency checkpoint with agent1. Read-only compatibility investigation and isolated adapter work can progress in parallel; framework/dependency or shared-CI changes require a clear file-ownership handover. Preserve existing accepted commits and do not reset or overwrite another intent.
3. Implement the smallest Workers compatibility slice using the existing V3 application: SSR/dynamic page, Google-authenticated account path, PostgreSQL transaction/fresh authorization read and existing signing/licensing vectors. Keep the Node/Docker target working. Consult current official framework/Cloudflare guidance before selecting and pinning tooling.
4. Use request/operation-scoped connection ownership and the real runtime binding. Preserve transactions, locks, serializable/idempotent behavior and cleanup. Disable caching for authorization-sensitive database reads. A primitive PostgreSQL test or local wall-clock timer does not prove Hyperdrive/workerd or deployed Free limits.
5. Retain one application/business-logic owner. Separate target configuration and necessary adapters; do not clone the app, move business policy into hosting code, switch PostgreSQL to D1, or introduce queues/services without a concrete requirement.
6. Treat real provider setup, installed native acceptance, staging resources, restore/hosting-switch acceptance and production as separate gates. Prepare concrete configuration/runbooks for review; do not activate them implicitly.

Keep the branded checkout workstream separate. It is planned in `BKE-BRANDED-CHECKOUT-PLAN.md`, not implemented by the authentication work. Reuse Payments/Commerce/Entitlements/Licensing; merchant capability, card approval, ShopeePay identifier resolution and recurring-consent gates remain. Do not mix payment changes into an auth or hosting patch.

## Shared integration rules

- GitHub is canonical; record the actual default branch and starting SHA. Preserve unrelated work and use guarded branch updates. No uncoordinated cross-agent cherry-picks, resets or whole-file conflict resolution.
- `.github/workflows/ci.yml` is touched by several existing intents: Google artifact capture, PostgreSQL readiness, dependency generation and dispatcher integration. Reconcile each change deliberately. Do not select one branch's entire file and discard the others.
- A PR comment currently loads the controller/reusable workflow definitions from main. Candidate checkout is not proof that a candidate's new workflow steps executed. Record source SHA **and** actual workflow SHA. The dispatcher prerequisite must be approved before treating its command as available.
- Keep exact source/target names in every CI report. Report PASS, FAIL, SKIPPED and CANCELLED accurately; a subset pass cannot clear a failing full/core gate.
- The corrected composition/host/Prisma workflows use distinct concurrency prefixes plus source SHA. Reusable `github.workflow` refers to the caller; avoid reintroducing sibling cancellation. Other unrelated workflow maintenance needs its own justified scope.
- Prisma schema/history remains restricted. Existing necessary Google additions are already implemented. No opportunistic hardening, migration rewriting or generated-code hand edits. Reproduce approved generated output through its actual generator and verify transferred artifacts.
- Immutable LegalAcceptance records stay immutable in tests. Use isolated/run-unique fixtures in disposable databases. Preserve organization, privacy, account, revocation, token rotation/replay and legal coverage; no skips or weakened controls to achieve green.
- Keep the Google-only product decision: no BKE password or magic-link fallback. Stable Google subject binds to BKE principal; matching email cannot link accounts or grant admin. Google profile verification does not silently verify BKE contact email. Sensitive actions use fresh BKE factor proof tied to the exact active browser session.
- Preserve native protocol, licensing/signing identities and account state ownership. Native password `410` and security `409` responses close legacy grant paths; they do not prove installed-client feature availability. Do not edit Agent/Launcher/product repositories under this handoff without a separately declared and authorized scope.

## Environment and authorization boundaries

Public origin: `https://jl-bke.com`. Exact Google redirect: `https://jl-bke.com/api/auth/google/callback`. Public audience: `762330940636-uuqstj4ig6ads84nid0bik35jkum4kt1.apps.googleusercontent.com`. No client secret or secret JSON was received. Secrets belong in protected configuration, never chat, source, Notion, artifacts or logs.

Cloudflare connection: **jlprojectfreedom**, not the separate jan2xo account. Fresh database is acceptable; old VPS/data remain untouched. Workers is primary, Docker is the cold fallback for the same application and state contracts. Initial infrastructure target is USD 0, not a verified free-tier/resource claim.

Continue only the bounded engineering intents already authorized by the owner and submit concrete results for review. This handoff provides no new authorization for merges, production deployment/cutover, paid resources, staging/provider provisioning, new credentials/access grants, merchant activation, live charges, destructive data operations or signing-trust changes. Prepare a concrete reviewed candidate before seeking any needed owner decision.

## Required report from each coding agent

Send the owner one self-contained report for forwarding to Sol:

```text
AGENT / INTENT:
REPOSITORY / PR / BRANCH:
VERIFIED DEFAULT BRANCH + SHA:
STARTING SHA:
EXACT CURRENT HEAD:
REQUIREMENT / ROOT CAUSE:
CHANGED FILES AND BOUNDED SCOPE:
ENGINEERING DECISION + REASON:
AUTHORITY / STATE / INTERFACE EFFECTS:
CI RUN URLS + TARGETS:
ACTUAL WORKFLOW SHA + CHECKED-OUT SOURCE SHA:
PASS / FAIL / SKIPPED / CANCELLED:
FIRST CAUSAL FAILURE, IF ANY:
ARTIFACT / PACKAGE PROVENANCE, IF RELEVANT:
WHAT WAS NOT VERIFIED:
DEPENDENCIES / CROSS-AGENT FILE HANDOVER:
SELF-ASSESSMENT: READY_FOR_REVIEW / REMEDIATE / BLOCKED
RECOMMENDED NEXT ACTION:
OWNER DECISION REQUIRED, IF ANY:
```

Do not include secret values or raw sensitive logs. The coding agent's self-assessment is input to review, not independent acceptance. Sol will verify the exact submitted head against GitHub and issue its own scoped verdict. A new head requires a new delta review; owner release authority remains separate.
