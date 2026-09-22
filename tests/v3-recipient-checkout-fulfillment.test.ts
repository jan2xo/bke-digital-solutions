import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recipientEmailFromFulfillmentSnapshot,
} from "@/apps/web/entitlements/commerce-claim-unit-issuer";

describe("V3 recipient checkout fulfillment", () => {
  it("normalizes only a valid recipient email from Commerce fulfillment context", () => {
    expect(recipientEmailFromFulfillmentSnapshot({ recipientEmail: " Person@Example.COM " }))
      .toBe("person@example.com");
    expect(recipientEmailFromFulfillmentSnapshot({ recipientEmail: "not-an-email" })).toBeNull();
    expect(recipientEmailFromFulfillmentSnapshot({})).toBeNull();
    expect(recipientEmailFromFulfillmentSnapshot(null)).toBeNull();
  });

  it("routes recipient checkout through CLAIM_CODE without changing payer account ownership", () => {
    const route = readFileSync("app/api/checkout/route.ts", "utf8");
    expect(route).toContain('fulfillmentMode: recipientEmail ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT"');
    expect(route).toContain("fulfillmentSnapshot: recipientEmail ? { recipientEmail } : {}");
    expect(route).toContain("accountId: access.account.id");
  });

  it("never runs buyer-side legacy license fulfillment for claim purchases", () => {
    const webhook = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
    expect(webhook).toContain('settlement.fulfillmentMode === "ACCOUNT_ENTITLEMENT"');
    expect(webhook).toContain("await fulfillOrderLicensing(");
  });

  it("creates recipient runtime licensing during the same claim transaction", () => {
    const claims = readFileSync("apps/web/entitlements/claim-codes.ts", "utf8");
    expect(claims).toContain("claim.orderId");
    expect(claims).toContain("{ accountId: input.accountId, orderItemId: claim.orderItemId }");
    expect(claims).toContain('sourceReference = `claim:${claim.id}`');
  });

  it("wires claim units into both paid and zero-payment Commerce fulfillment", () => {
    const module = readFileSync("modules/commerce/module.ts", "utf8");
    expect(module).toContain("createCommerceSettlementFulfillmentCapability");
    expect(module).toContain("COMMERCE_SETTLEMENT_FULFILLMENT_CAPABILITY_ID");
    expect(module).toContain("claimUnits: options.claimUnits");
  });

  it("exposes an explicit For me / For someone else customer choice", () => {
    const checkout = readFileSync("components/checkout-start-button.tsx", "utf8");
    expect(checkout).toContain("Who is this license for?");
    expect(checkout).toContain("For me");
    expect(checkout).toContain("For someone else");
    expect(checkout).toContain("Recipient email");
  });
});
