import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const claim = readFileSync("apps/web/entitlements/claim-codes.ts", "utf8");
const rights = readFileSync("apps/web/agent-sessions/product-lease-eligibility.ts", "utf8");
const integration = readFileSync("tests/integration/claim-gift-l2-lineage.test.ts", "utf8");

describe("Claim Code gift account-product L2 boundary", () => {
  it("checks actual paid gift source before a code may mint recipient rights", () => {
    const consume = claim.slice(claim.indexOf("export async function consumeClaimCode"));
    expect(consume).toContain('o."status" = \'PAID\'');
    expect(consume).toContain('o."paidAt" IS NOT NULL');
    expect(consume).toContain('o."fulfillmentMode" = \'CLAIM_CODE\'');
    expect(consume).toContain('o."accountId" = c."purchaserAccountId"');
    expect(consume).toContain('item."id" = c."orderItemId"');
    expect(consume).toContain('item."orderId" = o."id"');
    expect(consume).toContain('item."productId" = c."productId"');
    expect(consume).toContain('item."editionId" IS NOT DISTINCT FROM c."editionId"');
    expect(consume).toContain('item."purchasePlanId" IS NOT DISTINCT FROM c."purchasePlanId"');
    expect(consume).toContain('item."quantity" = 1');
    expect(consume).toContain('c."unitIndex" = 0');
    expect(consume.indexOf("const paidSource =")).toBeLessThan(consume.indexOf("const entitlementId = randomUUID()"));
    expect(consume).toContain('return { status: "REJECTED", code: "INVALID_CODE" }');
  });

  it("never gives purchaser A the recipient B gift; requires claimed purchaser and source order identity", () => {
    expect(rights).toContain('claim."claimedToAccountId" = ca."id"');
    expect(rights).toContain('claim."orderItemId" = l."orderItemId"');
    expect(rights).toContain('claim."orderId" = l."orderId"');
    expect(rights).toContain('claim."purchaserAccountId" = sourceOrder."accountId"');
    expect(rights).toContain('claim."productId" = p."id"');
    expect(rights).toContain('sourceOrder."fulfillmentMode" = \'CLAIM_CODE\'');
    expect(rights).toContain('sourceOrder."status" = \'PAID\'');
    expect(rights).toContain('claim."status" = \'CLAIMED\'');
    expect(rights).toContain('e."sourceReference" = (');
    expect(rights).not.toContain("issueAccountProductLeaseJws");
  });

  it("uses the real database and real redemption service, not a fake source-right fixture", () => {
    expect(integration).toContain("consumeClaimCode(tx, {");
    expect(integration).toContain("UPDATE \"Order\" SET \"fulfillmentMode\" = 'CLAIM_CODE'");
    expect(integration).toContain("readAccountProductLeaseEvidenceInTransaction");
    expect(integration).toContain('plan: "perpetual"');
    expect(integration).toContain('status: "eligible"');
    expect(integration).toContain('evidence(purchaserAccountId');
    expect(integration).toContain('evidence(unrelatedAccountId');
    expect(integration).toContain('code: "ALREADY_CLAIMED"');
    expect(integration).toContain('"revocationSnapshot" =');
    expect(integration).toContain('status: "REVOKED"');
    expect(integration).toContain('status: "PENDING"');
  });

  it("keeps production, signing, provider traffic and versioned environment flags out of gift verification", () => {
    expect(claim).not.toContain("issueAccountProductLeaseJws");
    expect(rights).not.toContain("createPrivateKey");
    expect(integration).not.toContain("PayMongo");
    expect(integration).not.toContain("Resend");
    expect(integration).not.toContain("V3_");
  });
});
