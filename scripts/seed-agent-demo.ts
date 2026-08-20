import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { randomBytes } from "node:crypto";
import { decryptLicenseKey, encryptLicenseKey, hashLicenseKey } from "../lib/security/crypto";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const PRODUCT_SLUG = "bke-agent-integration-test-product";
const PRODUCT_ID = "agent-demo-product";
const TEST_EMAIL = "agent-demo-owner@local.test";

async function main() {
  const product = await db.product.upsert({
    where: { slug: PRODUCT_SLUG },
    update: { name: "BKE Agent Integration Test Product", active: true, archivedAt: null },
    create: { id: PRODUCT_ID, slug: PRODUCT_SLUG, name: "BKE Agent Integration Test Product", summary: "Local Agent integration fixture", description: "TEST ONLY", type: "SOFTWARE", active: true },
  });
  const user = await db.user.upsert({ where: { email: TEST_EMAIL }, update: { lifecycleState: "ACTIVE", emailVerified: new Date() }, create: { email: TEST_EMAIL, name: "Local Agent Demo", emailVerified: new Date(), lifecycleState: "ACTIVE" } });
  const account = await db.customerAccount.upsert({ where: { id: `agent-demo-account-${product.id}` }, update: { lifecycleState: "ACTIVE", ownerId: user.id }, create: { id: `agent-demo-account-${product.id}`, type: "INDIVIDUAL", displayName: "BKE Agent Demo Account", billingEmail: TEST_EMAIL, ownerId: user.id, lifecycleState: "ACTIVE" } });
  const policy = await db.licensePolicy.upsert({ where: { id: `agent-demo-policy-${product.id}` }, update: { maxSeats: 1, maxDevicesPerSeat: 2, validityDays: null }, create: { id: `agent-demo-policy-${product.id}`, productId: product.id, name: "Agent Demo Policy", maxSeats: 1, maxDevicesPerSeat: 2 } });
  const edition = await db.edition.upsert({ where: { productId_slug: { productId: product.id, slug: "demo" } }, update: { active: true }, create: { productId: product.id, slug: "demo", name: "Demo", description: "TEST ONLY", maxUsers: 1, maxDevicesPerUser: 2 } });
  const plan = await db.purchasePlan.upsert({ where: { editionId_type: { editionId: edition.id, type: "PERPETUAL" } }, update: { active: true, amountMinor: 1 }, create: { editionId: edition.id, type: "PERPETUAL", amountMinor: 1, currency: "PHP", active: true } });
  const price = await db.price.upsert({ where: { id: `agent-demo-price-${product.id}` }, update: { active: true, licensePolicyId: policy.id, productId: product.id }, create: { id: `agent-demo-price-${product.id}`, productId: product.id, licensePolicyId: policy.id, name: "Agent Demo", amountMinor: 0, currency: "PHP", billingType: "ONE_TIME", active: true } });
  const version = await db.productVersion.upsert({ where: { productId_version: { productId: product.id, version: "1.0.0" } }, update: { lifecycle: "STABLE", active: true, publishedAt: new Date(), isLatest: true }, create: { productId: product.id, version: "1.0.0", operatingSystem: "Any", architecture: "universal", lifecycle: "STABLE", active: true, publishedAt: new Date(), isLatest: true } });
  const order = await db.order.upsert({ where: { number: "BKE-LOCAL-AGENT-DEMO" }, update: { status: "PAID", paidAt: new Date(), accountId: account.id }, create: { number: "BKE-LOCAL-AGENT-DEMO", accountId: account.id, status: "PAID", currency: "PHP", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, billingSnapshot: { name: account.displayName, email: TEST_EMAIL }, paidAt: new Date() } });
  const item = await db.orderItem.upsert({ where: { id: `agent-demo-item-${product.id}` }, update: { orderId: order.id, productId: product.id, priceId: price.id, policyId: policy.id, purchasePlanId: plan.id, editionId: edition.id }, create: { id: `agent-demo-item-${product.id}`, orderId: order.id, productId: product.id, priceId: price.id, policyId: policy.id, productName: product.name, priceName: "Agent Demo", quantity: 1, unitAmountMinor: 0, totalMinor: 0, billingType: "ONE_TIME", policySnapshot: { maxSeats: 1, maxDevicesPerSeat: 2 }, purchasePlanId: plan.id, editionId: edition.id, editionName: edition.name, planName: "Agent Demo", planType: "PERPETUAL", pricingSnapshot: { testOnly: true } } });
  const existing = await db.license.findUnique({ where: { orderItemId: item.id } });
  const licenseKey = "BKE-" + randomBytes(20).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-");
  const license = existing
    ? await db.license.update({ where: { id: existing.id }, data: { keyHash: hashLicenseKey(licenseKey), keyLastFour: licenseKey.slice(-4), keyCiphertext: encryptLicenseKey(licenseKey), status: "ACTIVE", expiresAt: null, maxSeats: 1, maxDevicesPerSeat: 10 } })
    : await db.license.create({ data: { publicId: `agent-demo-license-${product.id}`, keyHash: hashLicenseKey(licenseKey), keyLastFour: licenseKey.slice(-4), keyCiphertext: encryptLicenseKey(licenseKey), accountId: account.id, orderId: order.id, orderItemId: item.id, productId: product.id, editionId: edition.id, purchasePlanId: plan.id, status: "ACTIVE", maxSeats: 1, maxDevicesPerSeat: 2 } });
  console.info(JSON.stringify({ testOnly: true, productId: product.id, productSlug: product.slug, versionId: version.id, version: version.version, licenseId: license.id, licenseKey }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "SEED_FAILED"); process.exitCode = 1; }).finally(() => db.$disconnect());
