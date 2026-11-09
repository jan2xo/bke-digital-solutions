import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("V2 renewal checkout adoption", () => {
  it("routes renewals through the Commerce checkout orchestration capability", () => {
    const route = readFileSync("app/api/subscriptions/[id]/renew/route.ts", "utf8");

    expect(route).toContain("COMMERCE_CHECKOUT_ORCHESTRATION_CAPABILITY_ID");
    expect(route).toContain("getV2WebApplication");
    expect(route).toContain("renewalSubscriptionId: subscription.id");
    expect(route).toContain('acceptanceContext: "RENEWAL_CHECKOUT"');
    expect(route).toContain('checkoutResult.status === "PAYMENT_NOT_REQUIRED"');
    expect(route).not.toContain('from "@/lib/checkout"');
  });

  it("does not demand a business address when the normal legal checkout does not", () => {
    const renewal = readFileSync("app/api/subscriptions/[id]/renew/route.ts", "utf8");
    const standard = readFileSync("app/api/checkout/route.ts", "utf8");
    const agent = readFileSync("app/api/agent-sessions/store/checkout-start/route.ts", "utf8");

    // Published checkout agreements do not use a business_address placeholder.
    // Existing payment and legal authority remains bound to current versions.
    for (const file of [renewal, standard, agent]) {
      expect(file).toContain('support_email: requiredHostFact("SUPPORT_EMAIL")');
      expect(file).toContain('website: requiredHostFact("APP_URL")');
    }
    expect(renewal).not.toContain('requiredHostFact("BUSINESS_ADDRESS")');
    expect(renewal).not.toContain("business_address:");
    expect(renewal).toContain('selectedVersionIds: legalVersionIds');
    expect(renewal).toContain('acceptanceContext: "RENEWAL_CHECKOUT"');
    expect(renewal).toContain("await acceptance.record({");
    expect(renewal).toContain("checkout.start({");
  });

  it("keeps the legacy checkout implementation test-only", () => {
    const compatibility = readFileSync("lib/checkout.ts", "utf8");
    expect(compatibility).toContain("Test-only compatibility surface");
    expect(compatibility).toContain("@/tests/support/legacy-checkout-fixture");
    expect(compatibility).not.toContain("db.$transaction");
    expect(compatibility).not.toContain("paymentProvider.createCheckout");
  });
});
