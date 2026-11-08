# Cloudflare rate limiting and DDoS protection task

**Status:** Draft task. Implementation and runtime verification are pending.

## Objective

Protect the Digital Solutions Worker from abusive request bursts while preserving customer sign-in, checkout, licensing, and PayMongo webhook delivery. Use Cloudflare's existing managed DDoS protection, zone rules, and the app's existing route limits.

The launch audit observed a Cloudflare-managed HTTP DDoS ruleset, no custom zone rate-limit rule, and enabled Worker and preview URLs on `workers.dev`. Recheck those settings and the active zone plan before selecting controls. The Workers subscription and the website plan have separate entitlements.

## Implementation scope

- Confirm that the intended storefront traffic enters through the protected Cloudflare zone. Inventory reachable Worker hostnames and preview URLs. Propose how to disable or restrict alternate public URLs at launch so they cannot bypass the zone policy. Verify that an approved Staging deployment cannot reopen a production bypass.
- Keep managed DDoS protection in place. Start with the smallest plan-compatible rate-limit rule set for costly customer routes, using the existing app limits for finer control. Derive thresholds from normal traffic and expected bursts. Document the expression, counter key, threshold, mitigation, and shared-network impact. Add a Worker rate-limit binding only if there is a demonstrated coverage gap.
- Preserve application authorization and provider webhook signature checks. Keep PayMongo webhooks on a machine-compatible path with appropriate request limits, no browser challenge, and normal provider retries. Check Google OAuth callbacks and license clients separately from interactive browser routes.
- Keep GitHub repository visibility separate from storefront access. Confirm that the GitHub connector, protected CI, and any required private-repository permissions still work if repository visibility changes. Apply Cloudflare Access to a storefront, admin route, or preview only under an approved access policy that accounts for payment webhooks, OAuth, and native licensing clients.

## Acceptance checklist

- [ ] Record the verified zone plan, managed DDoS status, active hostnames, and existing route protection for the intended Worker.
- [ ] Review the rule expression, limits, and exemptions against actual routes and the plan's supported fields. Record the exact rule or config change and the rollback.
- [ ] On an approved isolated test target, show a small bounded burst receives the intended rate-limit response and legitimate requests recover after the mitigation window. Confirm ordinary traffic and shared-IP use remain acceptable. Do not simulate a DDoS against the public site.
- [ ] Exercise the receiving paths for Google sign-in, checkout, and license activation or refresh. Use an approved PayMongo test delivery or existing signed fixture to show that legitimate webhooks reach BKE, bad signatures fail, and retries do not duplicate fulfillment.
- [ ] Verify that alternate Worker and preview URLs are disabled or protected on the intended target and that the deploy configuration preserves that boundary.
- [ ] Record the exact source and config revision, the minimum required existing Intent Certification targets, staging evidence, where to inspect rate-limit events, and the rollback steps in this PR. Record production read-back separately after an authorized rollout.

This draft authorizes task definition only. Cloudflare changes, production deployment, access-policy changes, repository visibility changes, billing upgrades, and live payment tests require their respective owner authorization. The existing PayMongo activation and V3 integration retain their own PRs.

[Cloudflare DDoS protection](https://developers.cloudflare.com/ddos-protection/) · [WAF rate limiting and plan limits](https://developers.cloudflare.com/waf/rate-limiting-rules/) · [Worker and preview URLs](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) · [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
