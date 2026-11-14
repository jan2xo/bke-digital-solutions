# Protected preproduction Worker operator — source-only engineering intent

Parent ledger: [Digital Solutions #383](https://github.com/jan2xo/bke-digital-solutions/issues/383).

This change introduces a separately controlled, manual-only deployment operator for **bke-digital-solutions-preproduction**. It does not deploy a Worker, activate a hostname, publish a product, issue licenses, or change production.

## Immutable authority
- GitHub source: exact merged `main`, with owner-only manual `workflow_dispatch`; a supplied SHA alone is not proof.
- Cloudflare: personal account `9e39768c751719bfdfc4b915d2afd017` only. Do not access or change production Cloudflare account `384c6c13373eb94a2925e0d865139970`.
- Target: new script `bke-digital-solutions-preproduction`, Hyperdrive `ab7e957858234e46b0782707a46e0e4a` with independent restricted Neon role `bke_preproduction_runtime`. Deleted Hyperdrive `437f92c3b9a14489be6e3e7f21307821` forbidden.
- No automatic Worker routes, preview URLs, email-send binding, cron, production service, direct privileged database credentials, migration or DB write.
- No real PayMongo / Resend; all issuer, checkout, enrollment, privileged and backup flags OFF.
- No automatic PR, push, main or schedule deployment.

## Protected runtime prerequisites — NOT YET VERIFIED
A separate GitHub **Preproduction-Worker** environment with operator-only approval, narrowly scoped personal-account Cloudflare token, isolated nonproduction runtime secret bundle, approved Redis scope, approved application origin and nonproduction login/signing credentials is necessary before a deploy-mode dispatch. No secret, issuer or route is approved by this document. The earlier Infisical Prisma-migration identity is NOT Worker runtime-secret custody.

The current isolated test origin is `https://bke-digital-solutions-preproduction.jan2xpagauisan.workers.dev` (the personal account's independently confirmed `jan2xpagauisan.workers.dev` subdomain). Private upload still requires the approved exact origin and keeps `workers_dev=false` / `preview_urls=false`. No production DNS or hostname is modified. **Cloudflare Access must protect the whole Worker** before activation, and the protected GitHub environment variable `PREPRODUCTION_WORKER_ACCESS_OPERATOR_EMAIL` must match its sole approved operator email. The Cloudflare deployment API token must also have minimally scoped Access application read permission.


## Isolated HTTPS test origin — two protected operations

**Target:** `https://bke-digital-solutions-preproduction.jan2xpagauisan.workers.dev` in the independently verified **personal** Cloudflare account. This URL avoids editing the production `bkedigitalsolutions.com` DNS zone or moving production traffic. It must NOT be claimed live before route activation and external verification.

**Phase A — no ordinary public Worker route:** existing `deploy` mode installs the exact certified `main` application to the distinct `bke-digital-solutions-preproduction` Worker with `workers_dev=false`, `preview_urls=false`, no custom routes. This disables the normal workers.dev and preview routes while configuring the Worker; independently check Cloudflare's version/deployment URL behavior rather than asserting that all possible version URLs are inaccessible. It must still use independent runtime secrets/Redis and restricted Neon Hyperdrive. No active Cloudflare Access policy is inferred from a hostname alone.

**Phase B — explicit protected route activation (new mode `activate_access_route`):** after the Worker exists and its actual immutable Cloudflare `tag` is known, separately configure a **Worker-level Cloudflare Access application with destination `{type: worker, worker_id: <actual isolated Worker ID>}`**, protecting production AND preview/version URLs, restricted to the personal operator. The previously created hostname-scoped Access app alone is NOT enough to protect version URLs. The operator must independently GET the installed Worker identity, exact binding/provenance and Access destination+policy, then enable only its `workers.dev` route with previews disabled. Missing or permissive Access, stale source SHA, wrong script/bindings, unknown origin, or a public bypass DENIES. This step changes only isolated Worker subdomain configuration, never DNS, production, a deployment, or a database.

A worker-level Access login is not automatically a compatible non-browser Agent credential. Real native tests require separately approved Cloudflare Access service-token authentication and independent Agent transport proof. No unsigned bypass or blanket Access exception is authorized.

**Manual protection:** both phases use protected GitHub `Preproduction-Worker`, owner-only exact current `main`, and mode-specific confirmation. A private deployment or an Access app existing alone does not prove the HTTPS runtime is live. A later code update must again prove source/runtime match, and Wrangler's private `workers_dev=false` config will intentionally disable public routing until reactivated under the protected Access preflight.

## Source-only completion boundary
Acceptance is review and exact-head CI proof of fail-closed control-plane, credential, manifest and dispatch rules. Live Worker deployment, Hyperdrive-to-Neon SQL, signing authority, two genuine admins, and installed Windows Agent acceptance remain independent tasks and must not be claimed as certified from source tests.

## Manual operations
The workflow has a read-only `verify_only` mode and an explicit `deploy` mode. Both require the exact merged `main` SHA and owner confirmation. Deployment additionally requires approved protected environment values, and creates only the separately named Worker; it does not authorize real production services, endpoint exposure or issuer capability.
