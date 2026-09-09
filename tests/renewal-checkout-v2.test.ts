import { existsSync, readFileSync } from "node:fs";
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

  it("removes the legacy host-owned checkout implementation", () => {
    expect(existsSync("lib/checkout.ts")).toBe(false);
  });
});
