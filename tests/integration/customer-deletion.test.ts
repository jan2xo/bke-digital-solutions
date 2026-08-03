import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { closeCustomer, customerRetentionBlockers, CustomerLifecycleError, executeFinalPurge, markPurgeEligible, pseudonymizeCustomer, requestPrivacyDeletion, setLegalHold } from "@/lib/customer-lifecycle";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
let adminId = "", customerId = "", customerEmail = "", accountId = "", orderId = "", paymentId = "", licenseId = "";

describe.sequential("safe customer lifecycle", () => {
  beforeAll(async () => {
    customerEmail = `customer-lifecycle-${suffix}@bke.test`;
    const [admin, catalog] = await Promise.all([
      db.user.create({ data: { email: `customer-lifecycle-admin-${suffix}@bke.test`, role: "ADMIN", emailVerified: new Date() } }),
      db.price.findFirstOrThrow({ include: { product: true, licensePolicy: true } }),
    ]);
    adminId = admin.id;
    const customer = await db.user.create({ data: { email: customerEmail, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Lifecycle Test", billingEmail: customerEmail } } }, include: { ownedAccounts: true } });
    customerId = customer.id; accountId = customer.ownedAccounts[0]!.id;
    const order = await db.order.create({ data: { number: `CLIFE-${suffix}`, accountId, status: "PAID", currency: "PHP", subtotalMinor: catalog.amountMinor, taxMinor: 0, totalMinor: catalog.amountMinor, billingSnapshot: { email: customerEmail }, paidAt: new Date(), items: { create: { productId: catalog.productId, priceId: catalog.id, policyId: catalog.licensePolicyId, productName: catalog.product.name, priceName: catalog.name, quantity: 1, unitAmountMinor: catalog.amountMinor, totalMinor: catalog.amountMinor, billingType: catalog.billingType, policySnapshot: {} } } }, include: { items: true } });
    orderId = order.id;
    paymentId = (await db.payment.create({ data: { orderId, provider: "mock", externalId: `customer-lifecycle-${suffix}`, status: "REFUNDED", amountMinor: catalog.amountMinor, currency: "PHP", paidAt: new Date() } })).id;
    await db.invoice.create({ data: { number: `INV-CLIFE-${suffix}`, orderId, status: "FINAL", customerSnapshot: { email: customerEmail }, currency: "PHP", subtotalMinor: catalog.amountMinor, taxMinor: 0, totalMinor: catalog.amountMinor, issuedAt: new Date(), lines: { create: { description: catalog.product.name, quantity: 1, unitAmountMinor: catalog.amountMinor, totalMinor: catalog.amountMinor } } } });
    licenseId = (await db.license.create({ data: { publicId: `CLIFE-${suffix}`, keyHash: `customer-lifecycle-hash-${suffix}`, keyLastFour: "TEST", accountId, orderId, orderItemId: order.items[0]!.id, productId: catalog.productId, status: "ACTIVE", maxSeats: 1, maxDevicesPerSeat: 1 } })).id;
    await db.deviceActivation.create({ data: { licenseId, deviceHash: `customer-lifecycle-device-${suffix}` } });
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { OR: [{ actorId: adminId }, { targetId: customerId }] } });
    await db.deviceActivation.deleteMany({ where: { licenseId } });
    await db.license.deleteMany({ where: { id: licenseId } });
    await db.invoice.deleteMany({ where: { orderId } });
    await db.payment.deleteMany({ where: { id: paymentId } });
    await db.order.deleteMany({ where: { id: orderId } });
    await db.customerAccount.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { id: { in: [customerId, adminId] } } });
    await db.$disconnect();
  });

  it("protects administrators from the customer lifecycle", async () => {
    await expect(closeCustomer({ userId: adminId, actorId: adminId })).rejects.toBeInstanceOf(CustomerLifecycleError);
  });

  it("closes access while preserving commerce, invoice, payment, and license history", async () => {
    await closeCustomer({ userId: customerId, actorId: adminId });
    expect(await db.user.findUniqueOrThrow({ where: { id: customerId } })).toMatchObject({ lifecycleState: "CLOSED" });
    expect(await db.customerAccount.findUniqueOrThrow({ where: { id: accountId } })).toMatchObject({ lifecycleState: "CLOSED" });
    expect(await db.order.findUnique({ where: { id: orderId } })).not.toBeNull();
    expect(await db.payment.findUnique({ where: { id: paymentId } })).not.toBeNull();
    expect(await db.invoice.findUnique({ where: { orderId } })).not.toBeNull();
    expect(await db.license.findUniqueOrThrow({ where: { id: licenseId } })).toMatchObject({ status: "SUSPENDED" });
  });

  it("reports legal hold and preserved-history purge blockers", async () => {
    await setLegalHold({ userId: customerId, actorId: adminId, enabled: true, reason: "Synthetic dispute" });
    let report = await customerRetentionBlockers(customerId);
    expect(report.blockers).toContain("LEGAL_HOLD");
    expect(report.blockers).toContain("PRESERVED_COMMERCIAL_HISTORY");
    await setLegalHold({ userId: customerId, actorId: adminId, enabled: false });
    report = await customerRetentionBlockers(customerId);
    expect(report.blockers).not.toContain("LEGAL_HOLD");
  });

  it("pseudonymizes personal data without rewriting immutable snapshots", async () => {
    await requestPrivacyDeletion({ userId: customerId, actorId: adminId, retentionExpiresAt: new Date(Date.now() + 86_400_000) });
    await pseudonymizeCustomer({ userId: customerId, actorId: adminId });
    const user = await db.user.findUniqueOrThrow({ where: { id: customerId } });
    expect(user.email).toBe(`removed+${customerId}@privacy.invalid`);
    expect(user.emailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(user.name).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).billingSnapshot).toEqual({ email: customerEmail });
    expect((await db.invoice.findUniqueOrThrow({ where: { orderId } })).customerSnapshot).toEqual({ email: customerEmail });
  });

  it("permits an explicitly confirmed final purge only for an empty retained-history account", async () => {
    const empty = await db.user.create({ data: { email: `empty-purge-${suffix}@bke.test`, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Empty purge", billingEmail: `empty-purge-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
    await requestPrivacyDeletion({ userId: empty.id, actorId: adminId, retentionExpiresAt: new Date(Date.now() + 86_400_000) });
    await pseudonymizeCustomer({ userId: empty.id, actorId: adminId });
    await db.$transaction([
      db.user.update({ where: { id: empty.id }, data: { retentionExpiresAt: new Date(Date.now() - 1_000) } }),
      db.customerAccount.update({ where: { id: empty.ownedAccounts[0]!.id }, data: { retentionExpiresAt: new Date(Date.now() - 1_000) } }),
    ]);
    await markPurgeEligible({ userId: empty.id, actorId: adminId });
    await expect(executeFinalPurge({ userId: empty.id, actorId: adminId, confirmation: "wrong" })).rejects.toMatchObject({ code: "PURGE_CONFIRMATION_REQUIRED" });
    await expect(executeFinalPurge({ userId: empty.id, actorId: adminId, confirmation: `PURGE ${empty.id}` })).resolves.toEqual({ purged: true });
    expect(await db.user.findUnique({ where: { id: empty.id } })).toBeNull();
    expect(await db.auditLog.findFirst({ where: { action: "CUSTOMER_FINAL_PURGE_EXECUTED", targetId: empty.id } })).not.toBeNull();
  });
});
