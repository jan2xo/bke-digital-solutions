import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { checkoutSchema } from "@/apps/web/http/validation";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const base = {
  purchasePlanId: "c123456789012345678901234",
  customerAccountId: "c223456789012345678901234",
  legalVersionIds: [
    "c323456789012345678901234",
    "c423456789012345678901234",
  ],
};

describe("V3 recipient checkout fulfillment", () => {
  it("keeps existing checkout callers on SELF by default", () => {
    const result = checkoutSchema.parse(base);
    expect(result.purchaseFor).toBe("SELF");
    expect(result.recipientEmail).toBeUndefined();
  });

  it("requires and normalizes recipient email for OTHER", () => {
    expect(() => checkoutSchema.parse({ ...base, purchaseFor: "OTHER" })).toThrow();
    const result = checkoutSchema.parse({
      ...base,
      purchaseFor: "OTHER",
      recipientEmail: "Recipient@Example.COM",
    });
    expect(result.recipientEmail).toBe("recipient@example.com");
  });

  it("does not accept recipient identity on a SELF purchase", () => {
    expect(() => checkoutSchema.parse({
      ...base,
      purchaseFor: "SELF",
      recipientEmail: "recipient@example.com",
    })).toThrow();
  });

  it("routes recipient checkout into first-ownership claim fulfillment", async () => {
    const [checkout, checkoutPage, settlement, processing, licensing, module, button, pkg] = await Promise.all([
      read("app/api/checkout/route.ts"),
      read("app/checkout/page.tsx"),
      read("apps/web/payments/settlement-transaction.ts"),
      read("apps/web/payments/webhook-processing.ts"),
      read("apps/web/licensing/entitlement-management.ts"),
      read("modules/commerce/module.ts"),
      read("components/checkout-start-button.tsx"),
      read("package.json"),
    ]);

    expect(checkout).toContain('input.purchaseFor === "OTHER" ? "CLAIM_CODE" : "ACCOUNT_ENTITLEMENT"');
    expect(checkout).toContain("{ recipientEmail: input.recipientEmail }");
    expect(checkout).toContain("RECIPIENT_PURCHASE_REQUIRES_PERPETUAL_PLAN");
    expect(checkout).toContain("V3_CLAIM_CODE_CHECKOUT_ENABLED");
    expect(checkout).toContain("RECIPIENT_PURCHASE_UNAVAILABLE");
    expect(checkoutPage).toContain("recipientCheckoutEnabled && plan.type === \"PERPETUAL\"");

    expect(settlement).toContain("createCommerceSettlementFulfillmentCapability");
    expect(settlement).toContain("createTransactionalClaimUnitIssuer(tx)");
    expect(settlement).toContain('SELECT "fulfillmentMode"::text AS "fulfillmentMode", "fulfillmentSnapshot"');
    expect(settlement).toContain("purchasePlanId: item.purchasePlanId");
    expect(processing).toContain('settlement.fulfillmentMode === "ACCOUNT_ENTITLEMENT"');
    expect(processing).toContain('"status" IN (\'AVAILABLE\', \'CLAIMED\')');
    expect(processing).toContain('"status" = \'REVOKED\'');
    expect(processing).toContain('UPDATE "Entitlement"');
    expect(licensing).toContain("fulfillClaimedLicense");
    expect(licensing).toContain('acquisition: "CLAIM_CODE"');

    expect(module).toContain("createCommerceSettlementFulfillmentCapability");
    expect(module).toContain("const claimUnits: CommerceClaimUnitIssuer = options.claimUnits ??");
    expect(module).toContain("claimUnits,");
    expect(module).toContain("COMMERCE_SETTLEMENT_FULFILLMENT_CAPABILITY_ID");

    expect(button).toContain("For someone else");
    expect(button).toContain("recipientEmail");
    expect(pkg).toContain("commerce-v0.14.0");
  });


  it("gives the verified recipient a secretless pending-license inbox", async () => {
    const [page, card, acceptRoute, claimsService, claimCodes, dashboard] = await Promise.all([
      read("app/dashboard/claims/page.tsx"),
      read("components/recipient-claim-card.tsx"),
      read("app/api/claims/[id]/accept/route.ts"),
      read("apps/web/entitlements/recipient-claims.ts"),
      read("apps/web/entitlements/claim-codes.ts"),
      read("app/dashboard/page.tsx"),
    ]);

    expect(page).toContain("listPendingRecipientClaims(user.email)");
    expect(page).toContain("listClaimAuthorizedAccounts(user.id)");
    expect(page).toContain("RecipientClaimCard");
    expect(card).toContain('/api/claims/${claim.id}/accept');
    expect(card).not.toContain("claimCode");
    expect(acceptRoute).toContain("consumeRecipientClaimCode");
    expect(acceptRoute).toContain("fulfillClaimedLicense");
    expect(acceptRoute).toContain("principal.email");
    expect(acceptRoute).toContain('"CLAIM_ENTITLEMENT"');
    expect(claimCodes).toContain("requireRecipientBinding");
    expect(claimCodes).toContain("if (requireRecipientBinding && !claim.recipientEmail)");
    expect(claimCodes).toContain('WHERE "id" = ${input.claimCodeId}');
    expect(claimsService).toContain('WHERE c."recipientEmail" = ${email}');
    expect(claimsService).toContain(`c."status" = 'AVAILABLE'`);
    expect(dashboard).toContain('href="/dashboard/claims"');
  });

  it("persists fulfillment context before zero-payment fulfillment can run", async () => {
    const migration = await read(
      "prisma/migrations/20260923012000_v3_claim_fulfillment_context/migration.sql",
    );
    expect(migration).toContain('"fulfillmentSnapshot" JSONB NOT NULL');
  });
});
