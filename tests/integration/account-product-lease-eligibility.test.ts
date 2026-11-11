import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { grantProductTrial, changeTrial } from "@/apps/web/trials/service";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";
import { readAccountProductLeaseEvidenceInTransaction } from "@/apps/web/agent-sessions/product-lease-eligibility";
import { evaluateProductLeaseEligibility } from "@/apps/web/agent-sessions/product-lease-eligibility-policy";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

describe("account-product lease evidence x real durable seven-day trial", { concurrent: false }, () => {
  let accountId = "", otherAccountId = "", ownerId = "", editionId = "";
  let otherEditionId = "", productId = "", trialId = "", orderId = "";
  let orderItemId = "", entitlementId = "", trialEndsAt = new Date(0);

  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const user = await db.user.create({
      data: {
        email: `l2-trial-${suffix}@bke.test`,
        emailVerified: new Date(),
        ownedAccounts: {
          create: {
            type: "INDIVIDUAL",
            displayName: "L2 Trial Account",
            billingEmail: `l2-trial-${suffix}@bke.test`,
          },
        },
      },
      include: { ownedAccounts: true },
    });
    ownerId = user.id;
    accountId = user.ownedAccounts[0]!.id;
    const other = await db.customerAccount.create({
      data: {
        ownerId,
        type: "INDIVIDUAL",
        displayName: "L2 Other Account",
        billingEmail: `l2-other-${suffix}@bke.test`,
      },
    });
    otherAccountId = other.id;
    const edition = await db.edition.findFirstOrThrow({
      where: { product: { slug: "bke-deskflow", active: true }, active: true },
      include: { product: true },
    });
    editionId = edition.id;
    productId = edition.product.productId!;
    const alternate = await db.edition.create({
      data: {
        productId: edition.productId,
        slug: `l2-other-edition-${suffix}`,
        name: "Different Edition For L2 Negative Proof",
        maxUsers: 1,
        maxDevicesPerUser: 1,
      },
    });
    otherEditionId = alternate.id;
    const trial = await grantProductTrial({
      accountId, editionId, actorId: ownerId, source: "SELF_SERVICE",
    });
    trialId = trial.id;
    trialEndsAt = trial.trialEndsAt;
    const license = await db.license.findUniqueOrThrow({ where: { id: trial.licenseId } });
    orderId = license.orderId;
    orderItemId = license.orderItemId;
    const source = `commerce:${orderId}:${orderItemId}`;
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Entitlement" WHERE "sourceReference" = ${source}
    `;
    expect(rows).toHaveLength(1);
    entitlementId = rows[0]!.id;
  });
  afterAll(async () => { await db.$disconnect(); });

  async function evidence(now = new Date()) {
    return db.$transaction((tx) => readAccountProductLeaseEvidenceInTransaction(tx, {
      accountId, userId: ownerId, productId, now,
    }));
  }

  it("accepts same-order trial proof and caps source eligibility at trialEndsAt", async () => {
    const now = new Date();
    const rows = await evidence(now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entitlementId,
      entitlementStatus: "ACTIVE",
      licenseStatus: "ACTIVE",
      accountType: "INDIVIDUAL",
      accountOwnerId: ownerId,
      trialId,
      rightSourceVerified: true,
      purchasePlanType: null,
      subscriptionId: null,
    });
    expect(rows[0]?.entitlementValidUntil).toEqual(trialEndsAt);
    const catalog = await db.$transaction((tx) => readAgentSoftwareCatalog(tx, {
      accountId, userId: ownerId, platform: "windows", architecture: "x64",
    }));
    expect(catalog.find(x => x.productId === productId)?.entitled).toBe(true);

    // L2 source-right proof ONLY. Published release/installability and real
    // Agent-session token validation are separate authority checks.
    const base = {
      sessionId: "synthetic-test-only-session",
      accountId, userId: ownerId, productId,
      action: "OPEN" as const, now,
      productExists: true, productEntitled: true,
      productInstallable: true, productExecutionType: "STANDALONE",
    };
    expect(evaluateProductLeaseEligibility(base, rows)).toMatchObject({
      status: "eligible",
      plan: "trial",
      entitlementId,
      rightsExpireNoLaterThan: trialEndsAt,
    });
    expect(evaluateProductLeaseEligibility({
      ...base, now: new Date(trialEndsAt.getTime()),
    }, rows)).toMatchObject({ status: "denied" });
  });

  it("rejects an entitlement from another edition of the same product", async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "Entitlement" SET "resourceId" = ${otherEditionId} WHERE "id" = ${entitlementId}
      `;
      const rows = await readAccountProductLeaseEvidenceInTransaction(tx, {
        accountId, userId: ownerId, productId, now: new Date(),
      });
      expect(rows).toHaveLength(0);
      await tx.$executeRaw`
        UPDATE "Entitlement" SET "resourceId" = ${editionId} WHERE "id" = ${entitlementId}
      `;
    }, { isolationLevel: "Serializable" });
    expect(await evidence()).toHaveLength(1);
  });

  it("refuses direct commerce rights backed by another account's order", async () => {
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { accountId: otherAccountId } });
      const rows = await readAccountProductLeaseEvidenceInTransaction(tx, {
        accountId, userId: ownerId, productId, now: new Date(),
      });
      expect(rows).toHaveLength(0);
      await tx.order.update({ where: { id: orderId }, data: { accountId } });
    }, { isolationLevel: "Serializable" });
    expect(await evidence()).toHaveLength(1);
  });

  it("refuses the trial after durable-right revocation", async () => {
    await changeTrial({ trialId, actorId: ownerId, action: "REVOKE" });
    expect(await evidence()).toHaveLength(0);
    const catalog = await db.$transaction((tx) => readAgentSoftwareCatalog(tx, {
      accountId, userId: ownerId, platform: "windows", architecture: "x64",
    }));
    expect(catalog.find(x => x.productId === productId)?.entitled).toBe(false);
    const status = await db.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status" FROM "Entitlement" WHERE "id" = ${entitlementId}
    `;
    expect(status[0]?.status).toBe("REVOKED");
  });
});
