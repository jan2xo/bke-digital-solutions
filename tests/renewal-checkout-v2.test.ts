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

  it("keeps the legacy checkout implementation test-only", () => {
    const compatibility = readFileSync("lib/checkout.ts", "utf8");
    expect(compatibility).toContain("Test-only compatibility surface");
    expect(compatibility).toContain("@/tests/support/legacy-checkout-fixture");
    expect(compatibility).not.toContain("db.$transaction");
    expect(compatibility).not.toContain("paymentProvider.createCheckout");
  });
});
