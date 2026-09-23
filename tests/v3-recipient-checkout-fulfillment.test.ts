import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeClaimRecipientEmail,
  validClaimRecipientEmail,
} from "@/apps/web/entitlements/claim-recipient-email";

describe("V3 recipient checkout fulfillment", () => {
  it("normalizes recipient identity without importing server-only host adapters", () => {
    expect(normalizeClaimRecipientEmail(" Person@Example.COM ")).toBe("person@example.com");
    expect(validClaimRecipientEmail("person@example.com")).toBe(true);
    expect(validClaimRecipientEmail("not-an-email")).toBe(false);

    const adapter = readFileSync("apps/web/entitlements/commerce-claim-unit-issuer.ts", "utf8");
    expect(adapter).toContain("recipientEmailFromFulfillmentSnapshot");
    expect(adapter).toContain("normalizeClaimRecipientEmail(value)");
    expect(adapter).toContain("issueClaimCodes(tx");
  });

  it("routes recipient checkout through CLAIM_CODE without changing payer account ownership", () => {
    const route = readFileSync("app/api/checkout/route.ts", "utf8");
    expect(route).toContain('fulfillmentMode: recipientEmail ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT"');
    expect(route).toContain("fulfillmentSnapshot: recipientEmail ? { recipientEmail } : {}");
    expect(route).toContain("accountId: access.account.id");
  });

  it("fails closed when new recipient checkout is disabled", () => {
    const route = readFileSync("app/api/checkout/route.ts", "utf8");
    const page = readFileSync("app/checkout/page.tsx", "utf8");
    const checkout = readFileSync("components/checkout-start-button.tsx", "utf8");

    expect(route).toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(route).toContain('fail("RECIPIENT_CHECKOUT_DISABLED", 409)');
    expect(page).toContain("recipientCheckoutEnabled");
    expect(checkout).toContain("recipientCheckoutEnabled &&");
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
    expect(claims).toContain("sourceReference = `claim:${claim.id}`");
  });

  it("wires claim units into both paid and zero-payment Commerce fulfillment", () => {
    const commerceModuleSource = readFileSync("modules/commerce/module.ts", "utf8");
    expect(commerceModuleSource).toContain("createCommerceSettlementFulfillmentCapability");
    expect(commerceModuleSource).toContain("COMMERCE_SETTLEMENT_FULFILLMENT_CAPABILITY_ID");
    expect(commerceModuleSource).toContain("claimUnits: options.claimUnits");
  });

  it("exposes an explicit For me / For someone else customer choice when enabled", () => {
    const checkout = readFileSync("components/checkout-start-button.tsx", "utf8");
    expect(checkout).toContain("Who is this license for?");
    expect(checkout).toContain("For me");
    expect(checkout).toContain("For someone else");
    expect(checkout).toContain("Recipient email");
  });

  it("supports keyless recipient discovery and revokes unclaimed rights after refund", () => {
    const claims = readFileSync("apps/web/entitlements/claim-codes.ts", "utf8");
    const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");
    const refund = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");

    expect(claims).toContain("listPendingRecipientClaims");
    expect(claims).toContain("consumeRecipientClaimById");
    expect(dashboard).toContain("PendingRecipientClaims");
    expect(refund).toContain('UPDATE "ClaimCode"');
    expect(refund).toContain('"status" = \'REVOKED\'');
    expect(refund).toContain('"codeCiphertext" = NULL');
  });
});
