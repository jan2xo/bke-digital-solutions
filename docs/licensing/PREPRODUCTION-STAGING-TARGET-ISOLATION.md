# Isolated preproduction Worker target — source-only safety gate

Parent: [Licensing Agent positive startup acceptance #130](https://github.com/jan2xo/bke-licensing-agent/issues/130).
Base Digital Solutions main: `0673743f773cda877f130ab7c90150071fba2ff2`.
Pinned, unchanged Agent: `cb798ccf427d439b0ac4bad84000356dd087dc3e`.

## Intent

Prevent historical staging preparation code from ever selecting the existing production Cloudflare Worker or `bkedigitalsolutions.com` apex as a new staging target. Establish a **pure, source-only** candidate guard for a separately named Worker, a new independently controlled Neon project, nonproduction database/Hyperdrive and isolated service reference. The new guard is **NOT** a staging deploy command.

## Independently verified preproduction infrastructure (2026-11-14)

- **Cloudflare connection:** owner-selected `jan2xpagauisan@gmail.com`; account `9e39768c751719bfdfc4b915d2afd017`. The production account `384c6c13373eb94a2925e0d865139970`, production Worker `bke-digital-solutions` and production Hyperdrive `ea1691c683e64bd0b9acc3489ab7759c` remain forbidden. The separate account's four preexisting Workers must not be modified by this intent.
- **Neon:** separate project `tiny-mouse-06099628`, root `br-divine-dream-a1qhc381` (no parent), direct RW host `ep-polished-glade-a1u174wx.ap-southeast-1.aws.neon.tech`, database `bke_preproduction`. Official 70/70 migrations were independently certified in [run #43603233605](https://github.com/jan2xo/bke-digital-solutions/actions/runs/43603233605).
- **Cloudflare Hyperdrive (recreated after credential correction):** `bke-digital-solutions-preproduction` / `ab7e957858234e46b0782707a46e0e4a`, in the owner-selected account. Its control-plane metadata confirms the direct host/database/port; a nonproduction-only PATCH/GET confirmed query caching `disabled=true`, TLS `sslmode=require`, connection limit 10.
- **Restricted credential identity corrected by owner:** original Hyperdrive `437f92c3b9a14489be6e3e7f21307821` was removed and replaced by `ab7e957858234e46b0782707a46e0e4a`. Independent GET confirms the replacement authenticates as `bke_preproduction_runtime` (not privileged migration owner), with the same pinned direct host/database, caching disabled, TLS `require`, connection limit 10. The Neon restricted role was independently verified earlier as non-superuser, no CREATE DATABASE/ROLE, no BYPASSRLS, no schema CREATE. Cloudflare's API does not disclose the password and this metadata does **not** prove credential validity or live Worker connectivity. Never copy role passwords into code, GitHub or chat.
- **Worker and origin:** no `bke-digital-solutions-preproduction` Worker or active routing exists in the selected account. The existing proposed `https://preproduction.bkedigitalsolutions.com` origin is a non-deployed source candidate only; do not assume DNS delegation, TLS, routes or runtime secrets are configured. The Cloudflare account/domain boundary must be independently approved before any separate deployment.
- **Legacy:** production and old staging Neon projects, retired `deploy-staging.mjs`, and mock branch `br-soft-dawn-az9q94rd` remain out of scope.

## Candidate boundary

A source-only builder must require a distinct proposed Worker identity (`bke-digital-solutions-preproduction`) and independent nonproduction control-plane project and branch identity. It must not auto-provision, publish or expose any service. A generated candidate has **no Cloudflare routes, no workers.dev/preview URL, no email-send binding, no cron, no production service reference**, only default-OFF real issuer flags, mock payments/log-only mail and a separately identified staging Hyperdrive. Runtime secrets are never copied into the manifest.

The builder now pins the exact approved **Cloudflare account**, independent Neon root/direct host, existing Hyperdrive ID and restricted runtime database role. It also requires sanitized live Hyperdrive readback fields: origin database/role/direct host, caching disabled and TLS=require. **These arguments are not trusted evidence:** a caller could fabricate a passing snapshot. Before a separately authorized rollout, a trusted operator must independently GET the real Cloudflare configuration under the approved account and deny when any field differs, especially if the migration-owner username remains. No source-only candidate can prove passwords, DNS, signing custody or approved deploy origin.

## Certification plan

**Intent:** stop a retired staging code path from preparing the production Worker and prove nonproduction-only candidate manifest invariants.

- **Required exact-head:** `pr core platform host` (PR-specific denial tests; core runtime/build/security, platform boundary and host/Cloudflare delivery seam).
- **Not required:** payment, commerce, notifications, Agent, Launcher, Render Dock, Windows installers, protected Windows acceptance, production/web deployment.
- **Cross-repo:** immutable Agent `cb798ccf427d439b0ac4bad84000356dd087dc3e` reused unchanged; no new Agent CI.
- **Production:** LOCKED, no DB change, no signer/key, PayMongo/Resend, release/catalog, Cloudflare writes, Neon writes or protected workflow.

## Separate future privileged intent — NOT authorized by this PR

The owner-recreated Hyperdrive now advertises `bke_preproduction_runtime`; independent Cloudflare GET confirmed matching role/host/database/TLS/cache in account `9e39768c751719bfdfc4b915d2afd017`. It is not a live SQL connectivity test. Source-certify a dedicated Worker deployment workflow and separately approve isolated runtime OIDC/Infisical credential scopes, origin/DNS/HTTPS, Redis namespace, service binding, mock payments/log-only email, default-OFF issuer and enrollment flags. The current preproduction database is migrated and must **not** be migrated again. Real machine issuer keys, two genuine ADMIN reviews, signed product and Windows SYSTEM product startup evidence remain later separate intents. No production deployment/release is authorized.

