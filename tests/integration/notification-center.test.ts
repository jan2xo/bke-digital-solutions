import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
let ownerId = "";
let outsiderId = "";
let adminId = "";
let accountId = "";

describe.sequential("Digital Solutions durable notification center", () => {
  beforeAll(async () => {
    const owner = await db.user.create({
      data: {
        email: `notification-owner-${suffix}@bke.test`,
        emailVerified: new Date(),
        ownedAccounts: {
          create: {
            type: "INDIVIDUAL",
            displayName: "Notification Owner",
            billingEmail: `notification-owner-${suffix}@bke.test`,
          },
        },
      },
      include: { ownedAccounts: true },
    });
    ownerId = owner.id;
    accountId = owner.ownedAccounts[0]!.id;

    const outsider = await db.user.create({
      data: {
        email: `notification-outsider-${suffix}@bke.test`,
        emailVerified: new Date(),
      },
    });
    outsiderId = outsider.id;

    const admin = await db.user.create({
      data: {
        email: `notification-admin-${suffix}@bke.test`,
        emailVerified: new Date(),
        role: "ADMIN",
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await db.notificationReceipt.deleteMany({
      where: { userId: { in: [ownerId, outsiderId, adminId] } },
    });
    await db.notificationMessage.deleteMany({
      where: {
        idempotencyKey: { contains: suffix },
      },
    });
    await db.customerAccount.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({
      where: { id: { in: [ownerId, outsiderId, adminId] } },
    });
    await db.$disconnect();
  });

  it("persists ACCOUNT, ADMINISTRATORS, and PRINCIPAL notifications idempotently", async () => {
    const { persistNotificationOutsideTransaction } = await import(
      "@/apps/web/notifications/center"
    );

    const accountInput = {
      source: { moduleId: "commerce", event: "TEST_ACCOUNT", sourceReference: suffix },
      audience: { kind: "ACCOUNT" as const, accountId },
      content: {
        title: "Account notice",
        body: "Account-bound notification.",
        category: "TRANSACTIONAL" as const,
      },
      context: { trigger: "CUSTOM" as const, placementHint: "digital-solutions-inbox" },
      priority: "NORMAL" as const,
      idempotencyKey: `notification-center-account:${suffix}`,
      createdAt: new Date(),
    };

    expect((await persistNotificationOutsideTransaction(accountInput)).status).toBe("CREATED");
    expect((await persistNotificationOutsideTransaction(accountInput)).status).toBe("EXISTS");

    expect((await persistNotificationOutsideTransaction({
      source: { moduleId: "operations", event: "TEST_ADMIN", sourceReference: suffix },
      audience: { kind: "ADMINISTRATORS" as const },
      content: {
        title: "Admin notice",
        body: "Administrator-bound notification.",
        category: "SYSTEM" as const,
      },
      context: { trigger: "CUSTOM" as const, placementHint: "admin-inbox" },
      priority: "HIGH" as const,
      idempotencyKey: `notification-center-admin:${suffix}`,
      createdAt: new Date(),
    })).status).toBe("CREATED");

    expect((await persistNotificationOutsideTransaction({
      source: { moduleId: "identity", event: "TEST_PRINCIPAL", sourceReference: suffix },
      audience: { kind: "PRINCIPAL" as const, principalId: ownerId },
      content: {
        title: "Direct notice",
        body: "Principal-bound notification.",
        category: "SECURITY" as const,
      },
      context: { trigger: "CUSTOM" as const, placementHint: "digital-solutions-inbox" },
      priority: "NORMAL" as const,
      idempotencyKey: `notification-center-principal:${suffix}`,
      createdAt: new Date(),
    })).status).toBe("CREATED");

    expect(await db.notificationMessage.count({
      where: { idempotencyKey: { contains: suffix } },
    })).toBe(3);
  });

  it("enforces account, admin, and principal visibility boundaries", async () => {
    const { listNotificationsForUser } = await import(
      "@/apps/web/notifications/center"
    );

    const owner = await listNotificationsForUser({
      userId: ownerId,
      role: "CUSTOMER",
      limit: 50,
    });
    expect(owner.map((item) => item.event)).toEqual(
      expect.arrayContaining(["TEST_ACCOUNT", "TEST_PRINCIPAL"]),
    );
    expect(owner.some((item) => item.event === "TEST_ADMIN")).toBe(false);

    const outsider = await listNotificationsForUser({
      userId: outsiderId,
      role: "CUSTOMER",
      limit: 50,
    });
    expect(outsider.some((item) => item.event === "TEST_ACCOUNT")).toBe(false);
    expect(outsider.some((item) => item.event === "TEST_PRINCIPAL")).toBe(false);
    expect(outsider.some((item) => item.event === "TEST_ADMIN")).toBe(false);

    const admin = await listNotificationsForUser({
      userId: adminId,
      role: "ADMIN",
      limit: 50,
    });
    expect(admin.some((item) => item.event === "TEST_ADMIN")).toBe(true);
    expect(admin.some((item) => item.event === "TEST_ACCOUNT")).toBe(false);
  });

  it("owns per-user UNREAD → READ → DISMISSED receipts", async () => {
    const {
      dismissNotification,
      listNotificationsForUser,
      markNotificationRead,
    } = await import("@/apps/web/notifications/center");

    const before = await listNotificationsForUser({
      userId: ownerId,
      role: "CUSTOMER",
      limit: 50,
    });
    const accountNotice = before.find((item) => item.event === "TEST_ACCOUNT");
    expect(accountNotice?.state).toBe("UNREAD");

    expect(await markNotificationRead({
      userId: ownerId,
      role: "CUSTOMER",
      notificationId: accountNotice!.id,
    })).toMatchObject({ status: "UPDATED", state: "READ" });

    expect(await markNotificationRead({
      userId: ownerId,
      role: "CUSTOMER",
      notificationId: accountNotice!.id,
    })).toMatchObject({ status: "UNCHANGED", state: "READ" });

    expect(await dismissNotification({
      userId: ownerId,
      role: "CUSTOMER",
      notificationId: accountNotice!.id,
    })).toMatchObject({ status: "UPDATED", state: "DISMISSED" });

    const hidden = await listNotificationsForUser({
      userId: ownerId,
      role: "CUSTOMER",
      limit: 50,
    });
    expect(hidden.some((item) => item.id === accountNotice!.id)).toBe(false);

    const withDismissed = await listNotificationsForUser({
      userId: ownerId,
      role: "CUSTOMER",
      limit: 50,
      includeDismissed: true,
    });
    expect(withDismissed.find((item) => item.id === accountNotice!.id)?.state)
      .toBe("DISMISSED");
  });

  it("keeps account-bound data lifecycle-owned", async () => {
    const message = await db.notificationMessage.findUniqueOrThrow({
      where: { idempotencyKey: `notification-center-account:${suffix}` },
    });
    expect(message.audienceAccountId).toBe(accountId);
    expect(message.audienceKind).toBe("ACCOUNT");
  });
});
