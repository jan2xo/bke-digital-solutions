import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { evaluateProductDeletionEligibility, permanentlyDeleteProduct } from "@/lib/product-deletion";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
let actorId = "";

async function createProduct(options: { archived?: boolean; artifact?: boolean; image?: boolean } = {}) {
  const product = await db.product.create({
    data: {
      slug: `delete-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
      name: `Disposable ${Math.random().toString(36).slice(2, 8)}`,
      summary: "A synthetic deletion test product.",
      description: "A synthetic product used only by PostgreSQL integration tests.",
      type: "SOFTWARE",
      active: false,
      archivedAt: options.archived === false ? null : new Date(),
      imageKey: options.image ? `tests/${suffix}/image.png` : null,
    },
  });
  const policy = await db.licensePolicy.create({ data: { productId: product.id, name: "Test policy", maxSeats: 1, maxDevicesPerSeat: 1 } });
  const price = await db.price.create({ data: { productId: product.id, licensePolicyId: policy.id, name: "Test price", amountMinor: 10000, billingType: "ONE_TIME" } });
  const edition = await db.edition.create({ data: { productId: product.id, slug: "test", name: "Test", maxUsers: 1, maxDevicesPerUser: 1, purchasePlans: { create: { type: "PERPETUAL", amountMinor: 10000, renewalBehavior: "NONE" } } } });
  const version = await db.productVersion.create({ data: { productId: product.id, version: "0.0.1", operatingSystem: "Test", architecture: "test", active: false } });
  if (options.artifact) await db.productArtifact.create({ data: { productId: product.id, versionId: version.id, name: "test.zip", objectKey: `tests/${suffix}/${product.id}.zip`, sha256: "a".repeat(64), sizeBytes: 4, contentType: "application/zip", active: false } });
  return { product, policy, price, edition, version };
}

async function createCustomerOrder(productId: string, priceId: string, policyId: string) {
  const email = `delete-${suffix}-${Math.random().toString(36).slice(2, 8)}@bke.test`;
  const user = await db.user.create({ data: { email, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Deletion Test", billingEmail: email } } }, include: { ownedAccounts: true } });
  const order = await db.order.create({ data: { number: `DEL-${suffix}-${Math.random().toString(36).slice(2, 8)}`, accountId: user.ownedAccounts[0]!.id, status: "PENDING", currency: "PHP", subtotalMinor: 10000, taxMinor: 0, totalMinor: 10000, billingSnapshot: {}, items: { create: { productId, priceId, policyId, productName: "Snapshot product", priceName: "Snapshot price", quantity: 1, unitAmountMinor: 10000, totalMinor: 10000, billingType: "ONE_TIME", policySnapshot: {} } } } });
  return { user, account: user.ownedAccounts[0]!, order };
}

describe.sequential("archived product permanent deletion", () => {
  afterAll(async () => db.$disconnect());

  it("reports non-archived products as ineligible", async () => {
    actorId ||= (await db.user.create({ data: { email: `delete-admin-${suffix}@bke.test`, emailVerified: new Date(), role: "ADMIN" } })).id;
    const { product } = await createProduct({ archived: false });
    const result = await evaluateProductDeletionEligibility(product.id);
    expect(result).toMatchObject({ productExists: true, isArchived: false, canDelete: false, reason: "PRODUCT_NOT_ARCHIVED" });
  });

  it("deletes an archived empty product, exclusive children, and private objects while preserving its audit", async () => {
    const { product } = await createProduct({ artifact: true, image: true });
    const deletedObjects: string[] = [];
    const before = await evaluateProductDeletionEligibility(product.id);
    expect(before.canDelete).toBe(true);
    expect(before.removableResources).toMatchObject({ editions: 1, purchasePlans: 1, versions: 1, artifacts: 1, prices: 1, policies: 1, images: 1, storageObjects: 2 });
    await permanentlyDeleteProduct({ productId: product.id, actorId, confirmationName: product.name, deleteStorageObject: async (key) => { deletedObjects.push(key); } });
    expect(deletedObjects).toHaveLength(2);
    expect(await db.product.findUnique({ where: { id: product.id } })).toBeNull();
    expect(await db.productVersion.count({ where: { productId: product.id } })).toBe(0);
    expect(await db.productArtifact.count({ where: { productId: product.id } })).toBe(0);
    expect(await db.edition.count({ where: { productId: product.id } })).toBe(0);
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: product.id, action: "PRODUCT_DELETION_FINALIZED" } });
    expect(JSON.stringify(log.metadata)).not.toContain("tests/");
  });

  it("blocks order, invoice, payment, and payment-attempt history without changing preserved records", async () => {
    const { product, price, policy } = await createProduct();
    const { order } = await createCustomerOrder(product.id, price.id, policy.id);
    await db.paymentAttempt.create({ data: { orderId: order.id, provider: "mock", idempotencyKey: `delete-${suffix}-${order.id}`, status: "PENDING" } });
    await db.payment.create({ data: { orderId: order.id, provider: "mock", externalId: `delete-${suffix}-${order.id}`, status: "PENDING", amountMinor: 10000, currency: "PHP" } });
    await db.invoice.create({ data: { number: `INV-${suffix}-${Math.random().toString(36).slice(2, 7)}`, orderId: order.id, customerSnapshot: {}, currency: "PHP", subtotalMinor: 10000, taxMinor: 0, totalMinor: 10000 } });
    const eligibility = await evaluateProductDeletionEligibility(product.id);
    expect(eligibility.canDelete).toBe(false);
    expect(eligibility.blockingDependencies).toMatchObject({ orderItems: 1, orders: 1, invoices: 1, payments: 1, paymentAttempts: 1 });
    await expect(permanentlyDeleteProduct({ productId: product.id, actorId, confirmationName: product.name, deleteStorageObject: async () => undefined })).rejects.toMatchObject({ code: "PRODUCT_DELETE_BLOCKED" });
    expect(await db.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect(await db.order.findUnique({ where: { id: order.id } })).not.toBeNull();
  });

  it("blocks licenses, assignments, activations, download history, subscriptions, and customer carts", async () => {
    const { product, price, policy } = await createProduct({ artifact: true });
    const { user, account, order } = await createCustomerOrder(product.id, price.id, policy.id);
    const subscription = await db.subscription.create({ data: { accountId: account.id, orderId: order.id, productId: product.id, status: "ACTIVE", seats: 1, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000), renewalReminderAt: new Date() } });
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const license = await db.license.create({ data: { publicId: `PUB-${suffix}-${product.id}`, keyHash: `hash-${suffix}-${product.id}`, keyLastFour: "TEST", accountId: account.id, orderId: order.id, orderItemId: item.id, productId: product.id, subscriptionId: subscription.id, maxSeats: 1, maxDevicesPerSeat: 1 } });
    await db.licenseAssignment.create({ data: { licenseId: license.id, userId: user.id } });
    await db.deviceActivation.create({ data: { licenseId: license.id, deviceHash: `device-${suffix}-${product.id}` } });
    await db.licenseEvent.create({ data: { licenseId: license.id, type: "TEST" } });
    const artifact = await db.productArtifact.findFirstOrThrow({ where: { productId: product.id } });
    await db.downloadGrant.create({ data: { licenseId: license.id, artifactId: artifact.id, tokenHash: `grant-${suffix}-${product.id}`, expiresAt: new Date(Date.now() + 60000) } });
    await db.productArtifact.update({ where: { id: artifact.id }, data: { downloadCount: 1 } });
    await db.cart.create({ data: { accountId: account.id, expiresAt: new Date(Date.now() + 60000), items: { create: { priceId: price.id, quantity: 1 } } } });
    const eligibility = await evaluateProductDeletionEligibility(product.id);
    expect(eligibility.blockingDependencies).toMatchObject({ carts: 1, subscriptions: 1, licenses: 1, assignments: 1, activations: 1, downloadGrants: 1, downloads: 1, licenseEvents: 1 });
    expect(eligibility.canDelete).toBe(false);
  });

  it("rolls back database deletion when private storage cleanup fails and permits a safe retry", async () => {
    const { product } = await createProduct({ artifact: true });
    await expect(permanentlyDeleteProduct({ productId: product.id, actorId, confirmationName: product.name, deleteStorageObject: async () => { throw new Error("synthetic storage failure"); } })).rejects.toMatchObject({ code: "STORAGE_CLEANUP_PENDING" });
    expect(await db.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect(await db.productArtifact.count({ where: { productId: product.id } })).toBe(1);
    const jobs = await db.storageCleanupJob.findMany({ where: { productId: product.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("RETRYING");
  });
});
