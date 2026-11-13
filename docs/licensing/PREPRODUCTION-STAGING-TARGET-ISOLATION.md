# Isolated preproduction Worker target — source-only safety gate

Parent: [Licensing Agent positive startup acceptance #130](https://github.com/jan2xo/bke-licensing-agent/issues/130).
Base Digital Solutions main: `0673743f773cda877f130ab7c90150071fba2ff2`.
Pinned, unchanged Agent: `cb798ccf427d439b0ac4bad84000356dd087dc3e`.

## Intent

Prevent historical staging preparation code from ever selecting the existing production Cloudflare Worker or `bkedigitalsolutions.com` apex as a new staging target. Establish a **pure, source-only** candidate guard for a separately named Worker, a new independently controlled Neon project, nonproduction database/Hyperdrive and isolated service reference. The new guard is **NOT** a staging deploy command.

## Current verified infrastructure

- Production Worker name: `bke-digital-solutions`; only this Worker was listed in the connected Cloudflare primary account. Do **not** deploy a preproduction manifest using this name or its existing routes, secrets, service binding or Hyperdrive.
- Existing Neon projects `lingering-pond-33730332` (production), `bold-hat-55602908` (legacy staging). Existing staging/development branches are descendants of the production project and therefore not newly independent.
- Retained mock `br-soft-dawn-az9q94rd` stays on its separate cleanup ledger #370; it is not a candidate staging authority.
- Retired `deploy-staging.mjs` still contains historical production apex/Worker targeting; its GitHub workflow is archived. It must fail closed for manifest preparation.

## Candidate boundary

A source-only builder must require a distinct proposed Worker identity (`bke-digital-solutions-preproduction`) and independent nonproduction control-plane project and branch identity. It must not auto-provision, publish or expose any service. A generated candidate has **no Cloudflare routes, no workers.dev/preview URL, no email-send binding, no cron, no production service reference**, only default-OFF real issuer flags, mock payments/log-only mail and a separately identified staging Hyperdrive. Runtime secrets are never copied into the manifest.

A candidate object / synthetic positive test is **not** proof the project, branch, origin, signer or Worker exists, was created cleanly, or is operator approved. Must separately verify immutable real control-plane identity before **any** privileged deployment.

## Certification plan

**Intent:** stop a retired staging code path from preparing the production Worker and prove nonproduction-only candidate manifest invariants.

- **Required exact-head:** `pr core platform host` (PR-specific denial tests; core runtime/build/security, platform boundary and host/Cloudflare delivery seam).
- **Not required:** payment, commerce, notifications, Agent, Launcher, Render Dock, Windows installers, protected Windows acceptance, production/web deployment.
- **Cross-repo:** immutable Agent `cb798ccf427d439b0ac4bad84000356dd087dc3e` reused unchanged; no new Agent CI.
- **Production:** LOCKED, no DB change, no signer/key, PayMongo/Resend, release/catalog, Cloudflare writes, Neon writes or protected workflow.

## Separate future privileged intent

Only after this source gate passes: explicitly authorize a **fresh independently controlled Neon project/database** and separately named Cloudflare staging Worker/Hyperdrive/origin; verify control-plane metadata; apply official Prisma migrations from clean DS source; deploy staging-only runtime with isolated secret custody and distributed limiter. Then create real staging issuer/human approvals and installed Windows proof as separate protected acceptance.
