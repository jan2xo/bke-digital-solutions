import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Agent account-session Store catalog", () => {
  it("keeps Store catalog behind the Agent account-session boundary", () => {
    const route = readFileSync("app/api/agent-sessions/store/route.ts", "utf8");

    expect(route).toContain("authenticateAgentAccessToken");
    expect(route).toContain("requireAgentAccountSessionProtocol");
    expect(route).toContain("rejectBrowserOriginForAgent");
    expect(route).toContain("readAgentStoreCatalog");
    expect(route).toContain('"cache-control": "no-store"');
  });

  it("uses canonical Commerce pricing instead of duplicating plan math", () => {
    const catalog = readFileSync("apps/web/catalog/agent-store-catalog.ts", "utf8");

    expect(catalog).toContain("CommercePurchasePlanPricingCapability");
    expect(catalog).toContain("pricing.resolve(plan)");
    expect(catalog).toContain("resolved.pricing.amountMinor");
    expect(catalog).not.toContain("* 12");
    expect(catalog).not.toContain("10_000");
  });

  it("projects only active published products with active editions and plans", () => {
    const catalog = readFileSync("apps/web/catalog/agent-store-catalog.ts", "utf8");

    expect(catalog).toContain("active: true");
    expect(catalog).toContain("publishedAt: { not: null }");
    expect(catalog).toContain("archivedAt: null");
    expect(catalog).toContain("purchasePlans");
    expect(catalog).toContain("where: { active: true }");
  });

  it("exposes purchase presentation data without exposing payment authority", () => {
    const route = readFileSync("app/api/agent-sessions/store/route.ts", "utf8");

    for (const required of [
      "purchase_plan_id",
      "amount_minor",
      "billing_type",
      "renewal_behavior",
      "gift_checkout_enabled",
    ]) {
      expect(route).toContain(required);
    }

    for (const forbidden of [
      "checkoutUrl",
      "payment.checkoutUrl",
      "PAYMONGO",
      "payment_intent",
      "providerReference",
      "recipientEmail",
    ]) {
      expect(route).not.toContain(forbidden);
    }
  });

  it("keeps the gift rollout flag version-free", () => {
    const route = readFileSync("app/api/agent-sessions/store/route.ts", "utf8");

    expect(route).toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(route).not.toContain("V2_CLAIM_CODE");
    expect(route).not.toContain("V3_CLAIM_CODE");
  });
});
