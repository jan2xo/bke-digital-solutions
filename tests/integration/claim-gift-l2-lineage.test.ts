import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { env } from "@/platform/host/env";
import { consumeClaimCode } from "@/apps/web/entitlements/claim-codes";
import {
  encryptClaimCode, generateClaimCode, hashClaimCode,
} from "@/apps/web/entitlements/claim-code-material";
import { readAccountProductLeaseEvidenceInTransaction } from "@/apps/web/agent-sessions/product-lease-eligibility";
import { evaluateProductLeaseEligibility } from "@/apps/web/agent-sessions/product-lease-eligibility-policy";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const fixtureEncryptionSecret = "disposable-claim-gift-ciphertext-fixture-2026-only-not-production";
const now = () => new Date();
const plusDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000);

describe("one-unit cross-account Claim Code L2 source authority (real PostgreSQL)", { concurrent: false }, () => {
  let purchaserAccountId = "";
  let recipientAccountId = "";
  let unrelatedAccountId = "";
  let recipientUserId = "";
  let productId = "";
  let publicProductId = "";
  let editionId = "";
  let purchasePlanId = "";
  let priceId = "";
  let policyId = "";
  let priceMinor = 0;
  let orderId = "";
  let orderItemId = "";
  let claimCodeId = "";
  let paidCode = "";
  let entitlementId = "";
  let expectedValidUntil = new Date(0);

  async function seedGift(input: Readonly<{ status: "PAID" | "PENDING"; purchaserAccountId: string; unitIndex?: number }>) {
    const createdAt = now();
    const giftOrder = await db.order.create({
      data: {
        number: `BKE-GIFT-L2-${randomUUID()}`,
        accountId: input.purchaserAccountId,
        status: input.status,
        currency: "PHP",
        subtotalMinor: priceMinor,
        taxMinor: 0,
        totalMinor: priceMinor,
        paidAt: input.status === "PAID" ? createdAt : null,
        billingSnapshot: { testOnly: true, gift: true },
        items: {
          create: {
            productId,
            priceId,
            policyId,
            productName: "Gifted product",
            priceName: "Perpetual gift unit",
            quantity: 1,
            unitAmountMinor: priceMinor,
            totalMinor: priceMinor,
            billingType: "ONE_TIME",
            policySnapshot: { maxSeats: 1, maxDevicesPerSeat: 2 },
            editionId,
            purchasePlanId,
            planType: "PERPETUAL",
            editionName: "Professional",
            planName: "Perpetual",
          },
        },
      },
      include: { items: true },
    });
    // Prisma Order model predates the migration-owned fulfillmentMode.
    await db.$executeRaw`
      UPDATE "Order" SET "fulfillmentMode" = 'CLAIM_CODE' WHERE "id" = ${giftOrder.id}
    `;
    const item = giftOrder.items[0]!;
    const code = generateClaimCode();
    const codeId = randomUUID();
    const codeHash = hashClaimCode(code, env.LICENSE_PEPPER);
    const ciphertext = encryptClaimCode(code, fixtureEncryptionSecret);
    const validUntil = plusDays(createdAt, 30);
    const expiresAt = plusDays(createdAt, 3);
    await db.$executeRaw`
      INSERT INTO "ClaimCode" (
        "id", "orderId", "orderItemId", "unitIndex", "purchaserAccountId",
        "codeHash", "codeCiphertext", "codeLastFour", "status",
        "resourceId", "productId", "editionId", "purchasePlanId",
        "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil", "expiresAt",
        "createdAt", "updatedAt"
      ) VALUES (
        ${codeId}, ${giftOrder.id}, ${item.id}, ${input.unitIndex ?? 0}, ${input.purchaserAccountId},
        ${codeHash}, ${ciphertext}, ${code.slice(-4)}, 'AVAILABLE',
        ${editionId}, ${productId}, ${editionId}, ${purchasePlanId},
        ${JSON.stringify({ productId, editionId, maxUsers: 1 })}::jsonb,
        ${JSON.stringify({ source: "DISPOSABLE_GIFT_TEST", orderItemId: item.id })}::jsonb,
        ${createdAt}, ${validUntil}, ${expiresAt}, NOW(), NOW()
      )
    `;
    return { code, codeId, orderId: giftOrder.id, itemId: item.id, validUntil };
  }

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 12);
    const purchaser = await db.user.create({
      data: {
        email: `gift-buyer-${suffix}@bke.test`,
        emailVerified: new Date(),
        ownedAccounts: {
          create: { type: "INDIVIDUAL", displayName: "Gift Purchaser", billingEmail: `gift-buyer-${suffix}@bke.test` },
        },
      },
      include: { ownedAccounts: true },
    });
    purchaserAccountId = purchaser.ownedAccounts[0]!.id;
    const recipient = await db.user.create({
      data: {
        email: `gift-recipient-${suffix}@bke.test`,
        emailVerified: new Date(),
        ownedAccounts: {
          create: { type: "INDIVIDUAL", displayName: "Gift Recipient", billingEmail: `gift-recipient-${suffix}@bke.test` },
        },
      },
      include: { ownedAccounts: true },
    });
    recipientUserId = recipient.id;
    recipientAccountId = recipient.ownedAccounts[0]!.id;
    const unrelated = await db.user.create({
      data: {
        email: `gift-unrelated-${suffix}@bke.test`,
        emailVerified: new Date(),
        ownedAccounts: {
          create: { type: "INDIVIDUAL", displayName: "Unrelated Account", billingEmail: `gift-unrelated-${suffix}@bke.test` },
        },
      },
      include: { ownedAccounts: true },
    });
    unrelatedAccountId = unrelated.ownedAccounts[0]!.id;

    const edition = await db.edition.findFirstOrThrow({
      where: { product: { slug: "bke-deskflow", active: true }, active: true },
      include: { product: true },
    });
    const plan = await db.purchasePlan.findFirstOrThrow({
      where: { editionId: edition.id, type: "PERPETUAL", active: true },
    });
    const price = await db.price.findFirstOrThrow({
      where: { productId: edition.productId, billingType: "ONE_TIME", active: true },
    });
    editionId = edition.id;
    productId = edition.productId;
    publicProductId = edition.product.productId!;
    purchasePlanId = plan.id;
    priceId = price.id;
    policyId = price.licensePolicyId;
    priceMinor = price.amountMinor;
    const paid = await seedGift({ purchaserAccountId, status: "PAID" });
    paidCode = paid.code;
    claimCodeId = paid.codeId;
    orderId = paid.orderId;
    orderItemId = paid.itemId;
    expectedValidUntil = paid.validUntil;
  });

  afterAll(async () => { await db.$disconnect(); });

  async function evidence(accountId: string, userId: string) {
    return db.$transaction(tx => readAccountProductLeaseEvidenceInTransaction(tx, {
      accountId, userId, productId: publicProductId, now: now(),
    }));
  }

  it("rejects an AVAILABLE code that has no paid gift order", async () => {
    const pending = await seedGift({ purchaserAccountId, status: "PENDING" });
    const attempt = await db.$transaction(tx => consumeClaimCode(tx, {
      code: pending.code, accountId: recipientAccountId, userId: recipientUserId,
    }), { isolationLevel: "Serializable" });
    expect(attempt).toMatchObject({ status: "REJECTED", code: "INVALID_CODE" });
    const claimed = await db.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status" FROM "ClaimCode" WHERE "id" = ${pending.codeId}
    `;
    expect(claimed[0]?.status).toBe("AVAILABLE");
    expect(await db.license.count({ where: { orderId: pending.orderId } })).toBe(0);
  });

  it("real redemption grants only recipient B its own License and Entitlement", async () => {
    const result = await db.$transaction(tx => consumeClaimCode(tx, {
      code: paidCode, accountId: recipientAccountId, userId: recipientUserId,
    }), { isolationLevel: "Serializable" });
    expect(result.status).toBe("CLAIMED");
    if (result.status !== "CLAIMED") throw new Error("CLAIM_GIFT_REDEMPTION_FAILED");
    entitlementId = result.entitlementId;
    const sourceRef = `claim:${claimCodeId}`;
    const claim = await db.$queryRaw<Array<{
      status: string; claimedToAccountId: string; entitlementId: string;
    }>>`
      SELECT "status"::text AS "status", "claimedToAccountId", "entitlementId"
      FROM "ClaimCode" WHERE "id" = ${claimCodeId}
    `;
    expect(claim[0]).toMatchObject({
      status: "CLAIMED", claimedToAccountId: recipientAccountId, entitlementId,
    });
    const license = await db.license.findFirstOrThrow({ where: { orderItemId } });
    expect(license).toMatchObject({
      accountId: recipientAccountId, orderId, orderItemId,
      productId, editionId, purchasePlanId, status: "ACTIVE", maxSeats: 1,
    });
    const rows = await db.$queryRaw<Array<{
      subjectId: string; sourceReference: string; resourceId: string; validUntil: Date | null;
    }>>`
      SELECT "subjectId", "sourceReference", "resourceId", "validUntil"
        FROM "Entitlement" WHERE "id" = ${entitlementId}
    `;
    expect(rows[0]).toMatchObject({
      subjectId: recipientAccountId, sourceReference: sourceRef,
      resourceId: editionId, validUntil: expectedValidUntil,
    });

    const right = await evidence(recipientAccountId, recipientUserId);
    expect(right).toHaveLength(1);
    expect(right[0]).toMatchObject({
      entitlementId, licenseId: license.id,
      accountOwnerId: recipientUserId, purchasePlanType: "PERPETUAL",
      rightSourceVerified: true, entitlementValidUntil: expectedValidUntil,
    });
    const decision = evaluateProductLeaseEligibility({
      sessionId: "synthetic-source-proof-only",
      accountId: recipientAccountId, userId: recipientUserId, productId: publicProductId,
      action: "USE", now: now(), productExists: true, productEntitled: true,
      productInstallable: true, productExecutionType: "STANDALONE",
    }, right);
    expect(decision).toMatchObject({
      status: "eligible", plan: "perpetual",
      entitlementId, rightsExpireNoLaterThan: expectedValidUntil,
    });
    const catalog = await db.$transaction(tx => readAgentSoftwareCatalog(tx, {
      accountId: recipientAccountId, userId: recipientUserId,
      platform: "windows", architecture: "x64",
    }));
    expect(catalog.find(x => x.productId === publicProductId)?.entitled).toBe(true);
  });

  it("does not grant purchaser A or unrelated account C ownership of recipient B's gift", async () => {
    const purchaser = await db.user.findFirstOrThrow({ where: { ownedAccounts: { some: { id: purchaserAccountId } } } });
    const unrelated = await db.user.findFirstOrThrow({ where: { ownedAccounts: { some: { id: unrelatedAccountId } } } });
    expect(await evidence(purchaserAccountId, purchaser.id)).toHaveLength(0);
    expect(await evidence(unrelatedAccountId, unrelated.id)).toHaveLength(0);
    expect(await db.license.count({ where: { orderId, accountId: purchaserAccountId } })).toBe(0);
  });

  it("rejects replay of an already redeemed gift code", async () => {
    const replay = await db.$transaction(tx => consumeClaimCode(tx, {
      code: paidCode, accountId: recipientAccountId, userId: recipientUserId,
    }), { isolationLevel: "Serializable" });
    expect(replay).toMatchObject({ status: "REJECTED", code: "ALREADY_CLAIMED" });
    expect(await db.license.count({ where: { orderItemId } })).toBe(1);
  });

  it("rejects forged Claim Code account, product and purchaser/source links", async () => {
    const baseline = await evidence(recipientAccountId, recipientUserId);
    expect(baseline).toHaveLength(1);
    const mutations = [
      { column: "claimedToAccountId", value: unrelatedAccountId },
      { column: "purchaserAccountId", value: recipientAccountId },
      { column: "productId", value: "product-that-is-not-this-gift" },
    ] as const;
    for (const mutation of mutations) {
      await db.$transaction(async tx => {
        // Column names come ONLY from this compile-time literal test matrix.
        if (mutation.column === "claimedToAccountId") {
          await tx.$executeRaw`UPDATE "ClaimCode" SET "claimedToAccountId" = ${mutation.value} WHERE "id" = ${claimCodeId}`;
        } else if (mutation.column === "purchaserAccountId") {
          await tx.$executeRaw`UPDATE "ClaimCode" SET "purchaserAccountId" = ${mutation.value} WHERE "id" = ${claimCodeId}`;
        } else {
          // Use another real product ID to respect foreign-key constraints.
          const otherProduct = await tx.product.findFirstOrThrow({ where: { id: { not: productId } } });
          await tx.$executeRaw`UPDATE "ClaimCode" SET "productId" = ${otherProduct.id} WHERE "id" = ${claimCodeId}`;
        }
        expect(await readAccountProductLeaseEvidenceInTransaction(tx, {
          accountId: recipientAccountId, userId: recipientUserId,
          productId: publicProductId, now: now(),
        })).toHaveLength(0);
        await tx.$executeRaw`
          UPDATE "ClaimCode"
             SET "claimedToAccountId" = ${recipientAccountId},
                 "purchaserAccountId" = ${purchaserAccountId},
                 "productId" = ${productId}
           WHERE "id" = ${claimCodeId}
        `;
      }, { isolationLevel: "Serializable" });
    }
    expect(await evidence(recipientAccountId, recipientUserId)).toHaveLength(1);
  });

  it("refuses source right when the actual entitlement is revoked", async () => {
    await db.$executeRaw`
      UPDATE "Entitlement" SET "status" = 'REVOKED' WHERE "id" = ${entitlementId}
    `;
    expect(await evidence(recipientAccountId, recipientUserId)).toHaveLength(0);
    const catalog = await db.$transaction(tx => readAgentSoftwareCatalog(tx, {
      accountId: recipientAccountId, userId: recipientUserId,
      platform: "windows", architecture: "x64",
    }));
    expect(catalog.find(x => x.productId === publicProductId)?.entitled).toBe(false);
  });
});
