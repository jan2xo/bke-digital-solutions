import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = [
  "app/api/checkout/route.ts",
  "app/api/agent-sessions/store/checkout-start/route.ts",
] as const;

describe("self-purchase continuation route adoption", () => {
  it.each(routes)("%s resolves current ownership before creating checkout", (path) => {
    const route = readFileSync(path, "utf8");

    expect(route).toContain("resolveSelfPurchaseContinuation");
    expect(route).toContain("accountId: access.account.id");
    expect(route).toContain("editionId: edition.id");
    expect(route).toContain("purchasePlanId: plan.id");
    expect(route).toContain('selfPurchase.mode === "CONFLICT"');
    expect(route).toContain('"ENTITLEMENT_CONFLICT"');
  });

  it.each(routes)("%s renews the existing subscription instead of issuing a duplicate", (path) => {
    const route = readFileSync(path, "utf8");

    expect(route).toContain(
      'selfPurchase.mode === "RENEW" ? selfPurchase.subscriptionId : null',
    );
    expect(route).toContain(
      'renewalSubscriptionId ? "RENEWAL_CHECKOUT" : "CHECKOUT"',
    );
    expect(route).toContain(
      "...(renewalSubscriptionId ? { renewalSubscriptionId } : {})",
    );
    expect(route).toContain("acceptanceContext,");
  });

  it.each(routes)("%s keeps gift checkout independent from purchaser ownership", (path) => {
    const route = readFileSync(path, "utf8");

    expect(route).toContain("const selfPurchase = giftPurchase");
    expect(route).toContain('? ({ mode: "NEW" } as const)');
    expect(route).toContain(
      'fulfillmentMode: giftPurchase ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT"',
    );
  });
});
