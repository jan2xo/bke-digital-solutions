import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { CustomerDeletionError, permanentlyDeleteCustomer } from "@/lib/customer-deletion";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
let adminId = "";
let customerId = "";
let customerEmail = "";
let accountId = "";
let orderId = "";
let paymentId = "";
let licenseId = "";

describe.sequential("administrator customer permanent deletion", () => {
  beforeAll(async () => {
    customerEmail = `customer-delete-${suffix}@bke.test`;
    const [admin, catalog] = await Promise.all([
      db.user.create({ data: { email: `customer-delete-admin-${suffix}@bke.test`, role: "ADMIN", emailVerified: new Date() } }),
      db.price.findFirstOrThrow({ include: { product: true, licensePolicy: true } }),
    ]);
    adminId = admin.id;
    const customer = await db.user.create({
      data: { email: customerEmail, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Deletion Test", billingEmail: customerEmail } } },
      include: { ownedAccounts: true },
    });
    customerId = customer.id;
    accountId = customer.ownedAccounts[0]!.id;
    const order = await db.order.create({
      data: {
        number: `CDEL-${suffix}`, accountId, status: "PAID", currency: "PHP", subtotalMinor: catalog.amountMinor, taxMinor: 0, totalMinor: catalog.amountMinor,
        billingSnapshot: { email: customerEmail }, paidAt: new Date(),
        items: { create: { productId: catalog.productId, priceId: catalog.id, policyId: catalog.licensePolicyId, productName: catalog.product.name, priceName: catalog.name, quantity: 1, unitAmountMinor: catalog.amountMinor, totalMinor: catalog.amountMinor, billingType: catalog.billingType, policySnapshot: {} } },
      }, include: { items: true },
    });
    orderId = order.id;
    const payment = await db.payment.create({ data: { orderId, provider: "mock", externalId: `customer-delete-${suffix}`, status: "PAID", amountMinor: catalog.amountMinor, currency: "PHP", paidAt: new Date() } });
    paymentId = payment.id;
    await db.paymentAttempt.create({ data: { orderId, provider: "mock", idempotencyKey: `customer-delete-${suffix}`, status: "PAID" } });
    await db.invoice.create({ data: { number: `INV-CDEL-${suffix}`, orderId, status: "FINAL", customerSnapshot: { email: customerEmail }, currency: "PHP", subtotalMinor: catalog.amountMinor, taxMinor: 0, totalMinor: catalog.amountMinor, issuedAt: new Date(), lines: { create: { description: catalog.product.name, quantity: 1, unitAmountMinor: catalog.amountMinor, totalMinor: catalog.amountMinor } } } });
    const license = await db.license.create({ data: { publicId: `CDEL-${suffix}`, keyHash: `customer-delete-hash-${suffix}`, keyLastFour: "TEST", accountId, orderId, orderItemId: order.items[0]!.id, productId: catalog.productId, status: "ACTIVE", maxSeats: 1, maxDevicesPerSeat: 1 } });
    licenseId = license.id;
    await db.deviceActivation.create({ data: { licenseId, deviceHash: `customer-delete-device-${suffix}` } });
    await db.emailOutbox.create({ data: { type: "PAYMENT_RECEIPT", recipient: customerEmail, subject: "Test receipt", payload: { orderId } } });
  });

  afterAll(async () => {
    if (adminId) {
      await db.auditLog.deleteMany({ where: { actorId: adminId } });
      await db.user.deleteMany({ where: { id: adminId } });
    }
    await db.$disconnect();
  });

  it("rejects an incorrect email and leaves all records unchanged", async () => {
    await expect(permanentlyDeleteCustomer({ customerId, actorId: adminId, confirmationEmail: "wrong@bke.test" })).rejects.toMatchObject({ code: "CONFIRMATION_MISMATCH" });
    expect(await db.order.findUnique({ where: { id: orderId } })).not.toBeNull();
    expect(await db.payment.findUnique({ where: { id: paymentId } })).not.toBeNull();
  });

  it("never permits administrator deletion through this workflow", async () => {
    await expect(permanentlyDeleteCustomer({ customerId: adminId, actorId: adminId, confirmationEmail: `customer-delete-admin-${suffix}@bke.test` })).rejects.toBeInstanceOf(CustomerDeletionError);
  });

  it("atomically deletes the customer including commerce and licensing history", async () => {
    const summary = await permanentlyDeleteCustomer({ customerId, actorId: adminId, confirmationEmail: customerEmail });
    expect(summary).toEqual({ accounts: 1, orders: 1, licenses: 1 });
    expect(await db.user.findUnique({ where: { id: customerId } })).toBeNull();
    expect(await db.customerAccount.findUnique({ where: { id: accountId } })).toBeNull();
    expect(await db.order.findUnique({ where: { id: orderId } })).toBeNull();
    expect(await db.payment.findUnique({ where: { id: paymentId } })).toBeNull();
    expect(await db.license.findUnique({ where: { id: licenseId } })).toBeNull();
    expect(await db.emailOutbox.count({ where: { recipient: customerEmail } })).toBe(0);
    const tombstone = await db.auditLog.findFirstOrThrow({ where: { actorId: adminId, action: "CUSTOMER_PERMANENTLY_DELETED", targetId: customerId } });
    expect(tombstone.metadata).toEqual(summary);
    expect(JSON.stringify(tombstone)).not.toContain(customerEmail);
  });
});
