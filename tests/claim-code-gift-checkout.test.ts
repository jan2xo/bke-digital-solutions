import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Claim Code gift checkout", () => {
  it("maps gift checkout to CLAIM_CODE without a recipient identity", () => {
    const route = readFileSync("app/api/checkout/route.ts", "utf8");
    const validation = readFileSync("apps/web/http/validation.ts", "utf8");

    expect(validation).toContain('purchaseFor: z.enum(["SELF", "GIFT"])');
    expect(route).toContain('const giftPurchase = input.purchaseFor === "GIFT"');
    expect(route).toContain('fulfillmentMode: giftPurchase ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT"');
    expect(route).toContain("fulfillmentSnapshot: {}");
    expect(route).not.toContain("recipientEmail");
  });

  it("keeps gift creation behind the generation-free rollout flag", () => {
    const route = readFileSync("app/api/checkout/route.ts", "utf8");
    const page = readFileSync("app/checkout/page.tsx", "utf8");
    const checkout = readFileSync("components/checkout-start-button.tsx", "utf8");

    expect(route).toContain("CLAIM_CODE_CHECKOUT_ENABLED");
    expect(route).toContain('fail("GIFT_CHECKOUT_DISABLED", 409)');
    expect(page).toContain("giftCheckoutEnabled");
    expect(checkout).toContain("giftCheckoutEnabled &&");
    expect(checkout).toContain("Buy as gift / Claim Code");
    expect(checkout).not.toContain("Recipient email");
  });

  it("issues unbound claim units through Commerce", () => {
    const adapter = readFileSync("apps/web/entitlements/commerce-claim-unit-issuer.ts", "utf8");
    const claims = readFileSync("apps/web/entitlements/claim-codes.ts", "utf8");

    expect(adapter).toContain("issueClaimCodes(tx");
    expect(adapter).not.toContain("recipientEmail");
    expect(claims).not.toContain("recipientEmail");
    expect(claims).not.toContain("RECIPIENT_MISMATCH");
  });

  it("never gives the purchaser software ownership for a gift", () => {
    const webhook = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
    expect(webhook).toContain('settlement.fulfillmentMode === "ACCOUNT_ENTITLEMENT"');
    expect(webhook).toContain("await fulfillOrderLicensing(");
  });

  it("creates runtime licensing only when the Claim Code is redeemed", () => {
    const claims = readFileSync("apps/web/entitlements/claim-codes.ts", "utf8");
    expect(claims).toContain("claim.orderId");
    expect(claims).toContain("{ accountId: input.accountId, orderItemId: claim.orderItemId }");
    expect(claims).toContain("sourceReference = `claim:${claim.id}`");
  });

  it("lets the purchaser reveal available gift codes", () => {
    const account = readFileSync("app/dashboard/accounts/[id]/page.tsx", "utf8");
    const panel = readFileSync("components/gift-claim-codes.tsx", "utf8");
    const reveal = readFileSync("app/api/claims/[id]/reveal/route.ts", "utf8");

    expect(account).toContain("GiftClaimCodes");
    expect(account).toContain('"purchaserAccountId"');
    expect(panel).toContain("Reveal gift code");
    expect(panel).toContain("Send an available code to anyone you choose.");
    expect(reveal).toContain("revealClaimCode");
  });

  it("redeems the code into an authorized account without email matching", () => {
    const redeem = readFileSync("app/api/claims/redeem/route.ts", "utf8");
    expect(redeem).toContain("requireClaimAccountCapabilityInTransaction");
    expect(redeem).toContain("consumeClaimCode");
    expect(redeem).not.toContain("verifiedEmail");
    expect(redeem).not.toContain("RECIPIENT_MISMATCH");
  });

  it("provides a recipient-facing Claim Code redemption screen", () => {
    const page = readFileSync("app/redeem/page.tsx", "utf8");
    const component = readFileSync("components/claim-code-redeemer.tsx", "utf8");
    const authorization = readFileSync("apps/web/accounts/claim-code-authorization.ts", "utf8");
    const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");

    expect(page).toContain("Redeem software");
    expect(page).toContain("ClaimCodeRedeemer");
    expect(component).toContain("Redeem Claim Code");
    expect(component).toContain('fetch("/api/claims/redeem"');
    expect(component).toContain("BKE-CLM-");
    expect(authorization).toContain("listClaimAuthorizedAccounts");
    expect(authorization).toContain('"CLAIM_ENTITLEMENT"');
    expect(dashboard).toContain('href="/redeem"');
  });

  it("revokes still-unused gift codes after a confirmed refund", () => {
    const refund = readFileSync("apps/web/payments/webhook-processing.ts", "utf8");
    expect(refund).toContain('UPDATE "ClaimCode"');
    expect(refund).toContain('"status" = \'REVOKED\'');
    expect(refund).toContain('"codeCiphertext" = NULL');
    expect(refund).toContain('AND "status" = \'AVAILABLE\'');
  });
});
