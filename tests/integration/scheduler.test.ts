import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { schedulerHealth } from "@/lib/scheduler/health";
import { acquireSchedulerLock, releaseSchedulerLock } from "@/lib/scheduler/lock";
import { runScheduledJob, setScheduledJobEnabled, synchronizeScheduledJobs } from "@/lib/scheduler/service";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
let adminId = "", accountId = "", subscriptionId = "", licenseId = "";
const runIds: string[] = [];

describe.sequential("durable scheduler", () => {
  beforeAll(async () => {
    const admin = await db.user.create({ data: { email: `scheduler-admin-${suffix}@bke.test`, emailVerified: new Date(), role: "ADMIN" } }); adminId = admin.id;
    const owner = await db.user.create({ data: { email: `scheduler-owner-${suffix}@bke.test`, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Scheduler Test", billingEmail: `scheduler-owner-${suffix}@bke.test` } } }, include: { ownedAccounts: true } }); accountId = owner.ownedAccounts[0]!.id;
    const product = await db.product.create({ data: { slug: `scheduler-${suffix}`, name: "Scheduler Test", summary: "Scheduler test product", description: "Scheduler test product", type: "SAAS", editions: { create: { slug: "standard", name: "Standard", purchasePlans: { create: { type: "MONTHLY", amountMinor: 1000, renewalBehavior: "CUSTOMER_AUTHORIZED" } } } } }, include: { editions: { include: { purchasePlans: true } } } });
    const edition = product.editions[0]!, plan = edition.purchasePlans[0]!;
    const order = await db.order.create({ data: { number: `SCHED-${suffix}`, accountId, status: "PAID", currency: "PHP", subtotalMinor: 1000, taxMinor: 0, totalMinor: 1000, billingSnapshot: {}, items: { create: { productId: product.id, priceId: plan.id, policyId: edition.id, productName: product.name, priceName: "Monthly", quantity: 1, unitAmountMinor: 1000, totalMinor: 1000, billingType: "SUBSCRIPTION", policySnapshot: {}, editionId: edition.id, purchasePlanId: plan.id } } }, include: { items: true } });
    const end = new Date(Date.now() + 7 * 86_400_000);
    const subscription = await db.subscription.create({ data: { accountId, orderId: order.id, productId: product.id, editionId: edition.id, purchasePlanId: plan.id, status: "ACTIVE", seats: 1, currentPeriodStart: new Date(), currentPeriodEnd: end, renewalReminderAt: new Date(), currency: "PHP" } }); subscriptionId = subscription.id;
    const license = await db.license.create({ data: { publicId: crypto.randomUUID(), keyHash: `scheduler-hash-${suffix}`, keyLastFour: "TEST", accountId, orderId: order.id, orderItemId: order.items[0]!.id, productId: product.id, editionId: edition.id, purchasePlanId: plan.id, subscriptionId, status: "ACTIVE", maxSeats: 1, maxDevicesPerSeat: 1, expiresAt: new Date(Date.now() - 1_000) } }); licenseId = license.id;
    await synchronizeScheduledJobs();
  });
  afterAll(async () => {
    await db.scheduledJobRun.deleteMany({ where: { id: { in: runIds } } });
    await db.emailOutbox.deleteMany({ where: { OR: [{ deduplicationKey: { contains: subscriptionId } }, { deduplicationKey: { contains: licenseId } }] } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: adminId }, { targetType: "ScheduledJob" }, { targetType: "ScheduledJobRun" }] } });
    const order = await db.subscription.findUnique({ where: { id: subscriptionId }, select: { orderId: true, productId: true, account: { select: { ownerId: true } } } });
    if (order) { await db.licenseEvent.deleteMany({ where: { licenseId } }); await db.license.deleteMany({ where: { id: licenseId } }); await db.subscription.deleteMany({ where: { id: subscriptionId } }); await db.orderItem.deleteMany({ where: { orderId: order.orderId } }); await db.invoice.deleteMany({ where: { orderId: order.orderId } }); await db.order.deleteMany({ where: { id: order.orderId } }); await db.purchasePlan.deleteMany({ where: { edition: { productId: order.productId } } }); await db.edition.deleteMany({ where: { productId: order.productId } }); await db.product.deleteMany({ where: { id: order.productId } }); await db.customerAccount.deleteMany({ where: { id: accountId } }); await db.user.deleteMany({ where: { id: { in: [adminId, order.account.ownerId] } } }); }
    await db.$disconnect();
  });

  it("deduplicates the same scheduled window", async () => {
    const window = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const [first, second] = await Promise.all([
      runScheduledJob({ key: "email.outbox", trigger: "SCHEDULED", scheduledFor: window, dryRun: true }),
      runScheduledJob({ key: "email.outbox", trigger: "SCHEDULED", scheduledFor: window, dryRun: true }),
    ]);
    for (const result of [first, second]) if ("runId" in result && result.runId) runIds.push(result.runId);
    expect([first, second].filter((result) => "duplicate" in result)).toHaveLength(1);
  });
  it("releases a distributed lock only for its owner", async () => {
    const first = await acquireSchedulerLock(`test-${suffix}`, 10_000); expect(first).not.toBeNull();
    expect(await acquireSchedulerLock(`test-${suffix}`, 10_000)).toBeNull();
    await releaseSchedulerLock({ key: first!.key, owner: "not-the-owner" });
    expect(await acquireSchedulerLock(`test-${suffix}`, 10_000)).toBeNull();
    await releaseSchedulerLock(first!);
    const next = await acquireSchedulerLock(`test-${suffix}`, 10_000); expect(next).not.toBeNull(); await releaseSchedulerLock(next!);
  });
  it("pauses and resumes a job with audit history", async () => {
    await setScheduledJobEnabled("commerce.lifecycle", false, adminId);
    expect((await runScheduledJob({ key: "commerce.lifecycle", trigger: "MANUAL", dryRun: true })).reason).toBe("JOB_PAUSED");
    await setScheduledJobEnabled("commerce.lifecycle", true, adminId);
    expect((await db.scheduledJobDefinition.findUniqueOrThrow({ where: { key: "commerce.lifecycle" } })).enabled).toBe(true);
  });
  it("deduplicates renewal reminders and expires entitlement state", async () => {
    const first = await runScheduledJob({ key: "subscriptions.renewal-reminders", trigger: "MANUAL" }); if ("runId" in first && first.runId) runIds.push(first.runId);
    const second = await runScheduledJob({ key: "subscriptions.renewal-reminders", trigger: "MANUAL" }); if ("runId" in second && second.runId) runIds.push(second.runId);
    expect(await db.emailOutbox.count({ where: { deduplicationKey: { startsWith: `renewal-reminder:${subscriptionId}:` } } })).toBe(1);
    const reminder = await db.emailOutbox.findFirstOrThrow({ where: { deduplicationKey: { startsWith: `renewal-reminder:${subscriptionId}:` } } });
    expect(String((reminder.payload as Record<string, unknown>).renewalUrl)).toContain(`/dashboard/accounts/${accountId}#subscriptions`);
    const expiration = await runScheduledJob({ key: "entitlements.expiration", trigger: "MANUAL" }); if ("runId" in expiration && expiration.runId) runIds.push(expiration.runId);
    expect((await db.license.findUniqueOrThrow({ where: { id: licenseId } })).status).toBe("EXPIRED");
    expect(await db.licenseEvent.count({ where: { licenseId, type: "LICENSE_EXPIRED" } })).toBe(1);
    const again = await runScheduledJob({ key: "entitlements.expiration", trigger: "MANUAL" }); if ("runId" in again && again.runId) runIds.push(again.runId);
    expect(await db.licenseEvent.count({ where: { licenseId, type: "LICENSE_EXPIRED" } })).toBe(1);
  });
  it("reports durable job health", async () => {
    const health = await schedulerHealth();
    expect(health.registeredJobs).toBeGreaterThanOrEqual(8);
    expect(health.jobs.some((job) => job.key === "email.outbox")).toBe(true);
  });
});
