# Protected preproduction Worker operator — source-only engineering intent

Parent ledger: [Digital Solutions #383](https://github.com/jan2xo/bke-digital-solutions/issues/383).

This change introduces a separately controlled, manual-only deployment operator for **bke-digital-solutions-preproduction**. It does not deploy a Worker, activate a hostname, publish a product, issue licenses, or change production.

## Immutable authority
- GitHub source: exact merged `main`, with owner-only manual `workflow_dispatch`; a supplied SHA alone is not proof.
- Cloudflare: personal account `9e39768c751719bfdfc4b915d2afd017` only. Do not access or change production Cloudflare account `384c6c13373eb94a2925e0d865139970`.
- Target: new script `bke-digital-solutions-preproduction`, Hyperdrive `ab7e957858234e46b0782707a46e0e4a` with independent restricted Neon role `bke_preproduction_runtime`. Deleted Hyperdrive `437f92c3b9a14489be6e3e7f21307821` forbidden.
- No Worker routes, workers.dev / preview URLs, email-send binding, cron, production service, direct privileged database credentials, migration or DB write.
- No real PayMongo / Resend; all issuer, checkout, enrollment, privileged and backup flags OFF.
- No automatic PR, push, main or schedule deployment.

## Protected runtime prerequisites — NOT YET VERIFIED
A separate GitHub **Preproduction-Worker** environment with operator-only approval, narrowly scoped personal-account Cloudflare token, isolated nonproduction runtime secret bundle, approved Redis scope, approved application origin and nonproduction login/signing credentials is necessary before a deploy-mode dispatch. No secret, issuer or route is approved by this document. The earlier Infisical Prisma-migration identity is NOT Worker runtime-secret custody.

The proposed `https://preproduction.bkedigitalsolutions.com` is *only* a source candidate; DNS/TLS and ownership have not been verified. Deployment is denied unless the operator explicitly approves that exact origin using a separate protected variable. No DNS or hostname action occurs as part of this operator.

## Source-only completion boundary
Acceptance is review and exact-head CI proof of fail-closed control-plane, credential, manifest and dispatch rules. Live Worker deployment, Hyperdrive-to-Neon SQL, signing authority, two genuine admins, and installed Windows Agent acceptance remain independent tasks and must not be claimed as certified from source tests.

## Manual operations
The workflow has a read-only `verify_only` mode and an explicit `deploy` mode. Both require the exact merged `main` SHA and owner confirmation. Deployment additionally requires approved protected environment values, and creates only the separately named Worker; it does not authorize real production services, endpoint exposure or issuer capability.
