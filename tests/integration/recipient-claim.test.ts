import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";

process.env.CLAIM_CODE_ENCRYPTION_KEY =
  "9f4c7a2e8d1b6c3f5a0e7d9c2b4f6a8e1c3d5f7a9b2e4d6c8f0a1b3d5e7f9c2a";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

let purchaserUserId = "";
let purchaserAccountId = "";
let recipientUserId = "";
let recipientAccountId = "";
let recipientEmail = "";
let orderId = "";
let orderItemId = "";
let claimCodeId = "";

describe.sequential("recipient-bound first ownership", () => {
  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    recipientEmail = `recipient-claim-${suffix}@bke.test`;

    const purchaser = await db.user.create({
      data: {
        email: `purchaser-claim-${suffix}@bke.test`,
        name: "Recipient Purchase Buyer",
        emailVerified: new Date(),
        ownedAccounts: {
          create: {
            type: "INDIVIDUAL",
            displayName: "Recipient Purchase Buyer",
            billingEmail: `purchaser-claim-${suffix}@bke.test`,
          },
        },
      },
      include: { ownedAccounts: true },
    });
    purchaserUserId = purchaser.id;
    purchaserAccountId = purchaser.ownedAccounts[0]!.id;

    const recipient = await db.user.create({
      data: {
        email: recipientEmail,
        name: "Recipient Customer",
        emailVerified: new Date(),
        ownedAccounts: {
          create: {
            type: "INDIVIDUAL",
            displayName: "Recipient Customer",
            billingEmail: recipientEmail,
          },
        },
      },
      include: { ownedAccounts: true },
    });
    recipientUserId = recipient.id;
    recipientAccountId = recipient.ownedAccounts[0]!.id;

    const plan = await db.purchasePlan.findFirstOrThrow({
      where: { type: "PERPETUAL", active: true, edition: { active: true, product: { active: true } } },
      include: { edition: { include: { product: true } } },
    });

    const { createCheckout } = await import("@/lib/checkout");
    const checkout = await createCheckout(purchaserUserId, plan.id, purchaserAccountId);
    orderId = checkout.orderId;

    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    orderItemId = order.items[0]!.id;

    await db.$executeRaw`
      UPDATE "Order"
         SET "fulfillmentMode" = 'CLAIM_CODE',
             "fulfillmentSnapshot" = ${JSON.stringify({ recipientEmail })}::jsonb
       WHERE "id" = ${orderId}
    `;

    const item = order.items[0]!;
    const { issueClaimCodes } = await import("@/apps/web/entitlements/claim-codes");
    const issued = await db.$transaction((tx) => issueClaimCodes(tx, {
      orderId,
      orderItemId,
      purchaserAccountId,
      productId: item.productId,
      editionId: item.editionId,
      purchasePlanId: item.purchasePlanId,
      resourceId: item.editionId ?? item.productId,
      units: 1,
      scopeSnapshot: item.entitlementSnapshot ?? item.policySnapshot,
      grantSnapshot: {
        source: "integration-recipient-claim",
        orderId,
        orderItemId,
      },
      validFrom: new Date(),
      recipientEmail,
    }));
    if (issued.status !== "ISSUED") {
      throw new Error(`Expected recipient Claim Code issuance: ${JSON.stringify(issued)}`);
    }
    claimCodeId = issued.claimCodeIds[0]!;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("does not grant ownership to the purchaser when the recipient claim is issued", async () => {
    expect(await db.license.count({ where: { orderId } })).toBe(0);
    const purchaserEntitlements = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
        FROM "Entitlement"
       WHERE "subjectId" = ${purchaserAccountId}
         AND "sourceReference" = ${`claim:${claimCodeId}`}
    `;
    expect(Number(purchaserEntitlements[0]?.count ?? 0)).toBe(0);
  });

  it("rejects claim-by-id for a different verified email", async () => {
    const { consumeRecipientClaimCode } = await import("@/apps/web/entitlements/claim-codes");
    const result = await db.$transaction((tx) => consumeRecipientClaimCode(tx, {
      claimCodeId,
      userId: recipientUserId,
      accountId: recipientAccountId,
      verifiedEmail: "different-recipient@bke.test",
    }));
    expect(result).toEqual({ status: "REJECTED", code: "RECIPIENT_MISMATCH" });
    expect(await db.license.count({ where: { orderId } })).toBe(0);
  });

  it("creates the durable entitlement and current License directly in the recipient account", async () => {
    const { consumeRecipientClaimCode } = await import("@/apps/web/entitlements/claim-codes");
    const { fulfillClaimedLicense } = await import("@/apps/web/licensing/entitlement-management");

    const result = await db.$transaction(async (tx) => {
      const claim = await consumeRecipientClaimCode(tx, {
        claimCodeId,
        userId: recipientUserId,
        accountId: recipientAccountId,
        verifiedEmail: recipientEmail,
      });
      if (claim.status !== "CLAIMED") return claim;
      const license = await fulfillClaimedLicense(tx, {
        claimCodeId: claim.claimCodeId,
        accountId: recipientAccountId,
      });
      return { ...claim, licenseId: license.id };
    });

    expect(result.status).toBe("CLAIMED");

    const claimRows = await db.$queryRaw<Array<{
      status: string;
      claimedToAccountId: string | null;
      entitlementId: string | null;
      codeCiphertext: string | null;
    }>>`
      SELECT "status"::text AS "status", "claimedToAccountId", "entitlementId", "codeCiphertext"
        FROM "ClaimCode"
       WHERE "id" = ${claimCodeId}
    `;
    expect(claimRows[0]).toMatchObject({
      status: "CLAIMED",
      claimedToAccountId: recipientAccountId,
      codeCiphertext: null,
    });
    expect(claimRows[0]?.entitlementId).toBeTruthy();

    const entitlements = await db.$queryRaw<Array<{ subjectId: string; sourceReference: string }>>`
      SELECT "subjectId", "sourceReference"
        FROM "Entitlement"
       WHERE "id" = ${claimRows[0]!.entitlementId}
    `;
    expect(entitlements[0]).toEqual({
      subjectId: recipientAccountId,
      sourceReference: `claim:${claimCodeId}`,
    });

    const licenses = await db.license.findMany({
      where: { orderItemId },
      select: { accountId: true, orderId: true, status: true },
    });
    expect(licenses).toEqual([{
      accountId: recipientAccountId,
      orderId,
      status: "ACTIVE",
    }]);
    expect(await db.license.count({ where: { orderId, accountId: purchaserAccountId } })).toBe(0);
  });
});
