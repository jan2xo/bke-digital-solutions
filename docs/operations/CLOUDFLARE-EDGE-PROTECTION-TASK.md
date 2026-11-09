# Cloudflare edge protection — BKE source contract (PR #291)

**Status:** Source candidate only. **No production WAF rule, Worker routing, Cloudflare Access or billing change is authorized by this document.**

## Live owner-account inventory — verified 2026-11-10 (read-only)

- Account: JLPROJECT FREEDOM. Zone: `bkedigitalsolutions.com` (`93787269d12b05d928481be43d9bed91`), **Free Website** plan, ACTIVE full Cloudflare zone.
- Intended Worker: `bke-digital-solutions`, custom domain `bkedigitalsolutions.com`; no zone Worker routes. Direct script `workers.dev` route: **disabled**; preview/version URLs: **disabled**. The old PR text saying those were enabled was stale.
- DDoS L7 Cloudflare managed ruleset `4d21379b4f9f4bb088e0729962c8b3cf` present; Cloudflare Free Managed WAF `77454fe2d30c4220b5701f6fdfb893ba` present. No zone `http_ratelimit` entrypoint (404 = unconfigured). A 404 for `ddos_l7` entrypoint does **not** mean the provider-managed DDoS ruleset is missing.
- Legacy `/rate_limits` and `/firewall/rules` APIs return 410 deprecated. Use the Rulesets API.
- The Worker Paid plan is **not** implied by this zone's Free Website plan. Current account billing/subscription details remain inaccessible through the connector.

## Existing application controls and bounded baseline

- `POST /api/auth/google/start`: distributed rate limiter 10 / 900 seconds per client IP.
- `POST /api/checkout`: distributed rate limiter 10 / 3600 seconds per customer principal + IP. Requires authenticated principal, verified contact and purchase authorization.
- `POST /api/subscriptions/[id]/renew`: authenticated, account-ownership checked and legal/payment acceptance required; no separate edge limiter.
- `POST /api/webhooks/payments`: 240 / 60 sec/IP application limiter, bounded raw body, signed PayMongo verification/replay guards; must not be challenged by browser-edge security.
- Native Agent device/token and license APIs have their own authorization and several application rate limits; don't apply a browser challenge or pooled customer POST counter to them.
- **Cloudflare Workers observability snapshot**, 2026-11-09 00:00–2026-11-10 00:00 UTC, matching GET sample limits 100/path: checkout 7 POST (highest observed 2 in a minute), Google start 13 POST (highest observed 2 in a minute), renewal 1 POST, PayMongo webhook 42 POST (highest observed 6 in a minute). This is a **bounded historical log search, not a complete traffic forecast**. There is no proof of safe shared-IP behavior yet.

## One-rule candidate for the Free zone

Review `CLOUDFLARE-EDGE-RATE-LIMIT-CANDIDATE.json`. It contains **one** prospective `http_ratelimit` rule, intended for a future operator-approved Rulesets API phase entrypoint on the verified zone. Nothing in BKE source automatically applies it.

- **Scope:** `http.host eq "bkedigitalsolutions.com"`, `POST` only, and `/api/auth/google/start`, `/api/checkout`, or customer `/api/subscriptions/<id>/renew` (prefix/suffix functions).
- **Counting:** per `ip.src` + `cf.colo.id`, pooled across these three paths. **Threshold:** 20 requests per 10 seconds, **Block** for 10 seconds after threshold. This is conservative versus observed requests, not a performance guarantee. The Free plan supports one rule, IP counting, a 10-second period, 10-second Block duration (no Managed Challenge). Rule language function support and plan restrictions must still be validated via `dry_run` and isolated target before approval.
- **Explicit exclusions:** Google OAuth callback, signed PayMongo webhook, Cron, native Agent device and licensing APIs, admin/authenticated GET, ordinary store pages and static assets. Normal per-user application rate limits continue even if the WAF counter is evaded.
- **Shared NAT / false-positive risk:** multiple customers sharing an IP and colo consume the **same** counter across login + purchase + renewal. Cloudflare may count asynchronous request spikes and block legitimate clients; there is no guarantee every excess request is stopped instantly. If isolated proof cannot show acceptable NAT behavior, do **not** enable this pooled Free rule. Consider Worker-backed identity-aware limits or a paid plan only after a demonstrated gap and explicit owner approval.
- **Normalization:** verify that decoded/encoded/case-variant paths accepted by Next.js cannot bypass the WAF filter; keep application authorization and rate limits authoritative.

## Protected publishing and rollback

1. **Before a WAF write:** verify intended account/zone, unchanged Free plan, current `http_ratelimit` entrypoint still absent, existing managed DDoS, active custom domain and disabled alternate Worker/preview URLs. Verify a protected Staging or isolated test target; do **not** stress the production host.
2. Validate the exact candidate via Rulesets API `dry_run=true` on an isolated/approved target, then run a tiny bounded test: valid Google login initiation, permitted checkout/renewal test flow, OAuth callback, license/Agent token poll, signed PayMongo fixture and replay rejection, and two distinct customers sharing IP. Require expected 429 and recovery at the 10-second mitigation boundary. No real PayMongo charge or unbounded attack simulation.
3. Record target ID, rule ID, ruleset/version, installed expression, action/counters, WAF Security Events, false positives and observed normal flow. Approval to test does not imply production approval. Do not enable Cloudflare Access on payment callbacks/webhooks or native Agents.
4. **Only after explicit owner production authorization:** apply the one-rule config to the verified zone, GET the resulting phase entrypoint and rule version, and verify no implicit replacement of other WAF rules. On unexpected 429s or checkout/login disruption, revert by disabling/deleting only the newly created WAF rule or restoring the pre-change entrypoint version; re-read live ruleset and Security Events.
5. **Alternate URL protection:** `wrangler.jsonc` explicitly contains `workers_dev:false` and `preview_urls:false`; the guarded `scripts/deploy-web-code-only.mjs` rejects any source manifest that permits either. Cloudflare live script subdomain settings must also remain disabled after any protected release; read back separately. These source settings are a defense against future re-opening, not a claimed production change.

## Certification boundaries

- **Source:** verify JSON payload shape, explicit host/path/method exemptions, existing signed-webhook + app rate-limiter sources and the protected Worker release config; run intentional `pr + core + host + identity + payments + licensing` certification against an exact head and security self-review.
- **Not required:** `legal, platform, agent-store, notifications, native packaging` because no contract/logic change in those layers. No cross-repo change.
- **Live:** no isolated Cloudflare 429/recovery or shared-NAT experiment yet; no production WAF rule should be applied merely because source CI passed. This PR's **source phase** can be certified/merged separately, while the **live activation** remains blocked until owner-approved isolated and production proof.

Official docs: [WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) · [Rulesets API](https://developers.cloudflare.com/ruleset-engine/rulesets-api/) · [Workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) · [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/).
