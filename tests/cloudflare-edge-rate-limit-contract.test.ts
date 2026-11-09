import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildProductionConfig } from "../scripts/deploy-web-code-only.mjs";

const candidate = JSON.parse(readFileSync("docs/operations/CLOUDFLARE-EDGE-RATE-LIMIT-CANDIDATE.json", "utf8"));
const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const rule = candidate.rules[0];

/**
 * Source policy model, not Cloudflare WAF execution. Actual Rules language
 * parsing, enforcement, recovery and shared-IP behavior need isolated target
 * certification before any production rule creation.
 */
function intendedCustomerPost(host: string, method: string, path: string): boolean {
  return host === "bkedigitalsolutions.com" && method === "POST" && (
    path === "/api/auth/google/start" ||
    path === "/api/checkout" ||
    (path.startsWith("/api/subscriptions/") && path.endsWith("/renew"))
  );
}

describe("BKE Cloudflare Free edge rate-limit source contract", () => {
  it("defines exactly one documented Free-compatible rule scoped to interactive POSTs", () => {
    expect(candidate).toMatchObject({phase:"http_ratelimit",kind:"zone"});
    expect(candidate.rules).toHaveLength(1);
    expect(rule.action).toBe("block");
    expect(rule.enabled).toBe(true);
    expect(rule.ratelimit).toEqual({
      characteristics:["cf.colo.id","ip.src"],period:10,requests_per_period:20,mitigation_timeout:10,
    });
    expect(rule.expression).toBe('(http.host eq "bkedigitalsolutions.com" and http.request.method eq "POST" and (http.request.uri.path eq "/api/auth/google/start" or http.request.uri.path eq "/api/checkout" or (starts_with(http.request.uri.path, "/api/subscriptions/") and ends_with(http.request.uri.path, "/renew"))))');
    expect(rule).not.toHaveProperty("counting_expression");
    expect(rule).not.toHaveProperty("action_parameters");
  });

  it.each([
    ["/api/auth/google/start", "POST", true],
    ["/api/checkout", "POST", true],
    ["/api/subscriptions/subscription-123/renew", "POST", true],
    ["/api/auth/google/start", "GET", false],
    ["/api/auth/google/callback", "GET", false],
    ["/api/webhooks/payments", "POST", false],
    ["/api/cron/email-outbox", "POST", false],
    ["/api/agent-sessions/device/start", "POST", false],
    ["/api/agent-sessions/device/token", "POST", false],
    ["/api/agent-sessions/refresh", "POST", false],
    ["/api/agent-sessions/store/checkout-start", "POST", false],
    ["/api/licenses/activate", "POST", false],
    ["/api/licenses/refresh", "POST", false],
    ["/api/health/ready", "GET", false],
    ["/products", "GET", false],
    ["/manifest.webmanifest", "GET", false],
    ["/api/subscriptions/subscription-123/renew/extra", "POST", false],
  ] as const)("documents %s %s matched=%s", (path, method, expected) => {
    expect(intendedCustomerPost("bkedigitalsolutions.com", method, path)).toBe(expected);
    expect(intendedCustomerPost("other.example.com", method, path)).toBe(false);
  });

  it("checks actual receiving files for the identity, checkout, renewal and webhook trust controls", () => {
    const files = {
      google:readFileSync("app/api/auth/google/start/route.ts","utf8"),
      checkout:readFileSync("app/api/checkout/route.ts","utf8"),
      renewal:readFileSync("app/api/subscriptions/[id]/renew/route.ts","utf8"),
      webhook:readFileSync("app/api/webhooks/payments/route.ts","utf8"),
    };
    expect(files.google).toContain("google-login:");
    expect(files.checkout).toContain("checkout:");
    expect(files.checkout).toContain("purchaseAccess.authorize");
    expect(files.renewal).toContain("requireUser");
    expect(files.webhook).toContain("processPaymentWebhook");
  });

  it("pins both alternate Worker URL types closed in source and code-only production release", () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    const production = buildProductionConfig(config);
    expect(production.workers_dev).toBe(false);
    expect(production.preview_urls).toBe(false);
    for (const patch of [{workers_dev:true},{preview_urls:true}]) {
      expect(() => buildProductionConfig({...config,...patch})).toThrow();
    }
  });
});
