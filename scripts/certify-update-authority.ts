import "dotenv/config";
import { createHash, createHmac } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const licenseKey = "BKE-CERTIFICATION-UPDATE-2026";
const body = Buffer.from("#!/usr/bin/env sh\necho authority-product-v2\nif [ \"$1\" = \"--health\" ]; then exit 0; fi\n");
const sha256 = createHash("sha256").update(body).digest("hex");
const licenseHash = createHmac("sha256", process.env.LICENSE_PEPPER!).update(licenseKey).digest("hex");

async function main() {
  const product = await db.product.upsert({ where: { slug: "bke-certification-product" }, update: { active: true, publishedAt: new Date() }, create: { slug: "bke-certification-product", name: "BKE Certification Product", summary: "CI fixture", description: "Disposable certification fixture", type: "SOFTWARE", active: true, publishedAt: new Date() } });
  const policy = await db.licensePolicy.upsert({ where: { id: "certification-policy" }, update: {}, create: { id: "certification-policy", productId: product.id, name: "Certification", maxSeats: 1, maxDevicesPerSeat: 2, validityDays: null } });
  const edition = await db.edition.upsert({ where: { productId_slug: { productId: product.id, slug: "certification" } }, update: { active: true }, create: { productId: product.id, slug: "certification", name: "Certification", updatePolicy: "LIFETIME", active: true } });
  const plan = await db.purchasePlan.upsert({ where: { editionId_type: { editionId: edition.id, type: "PERPETUAL" } }, update: { active: true }, create: { editionId: edition.id, type: "PERPETUAL", amountMinor: 1, currency: "PHP", renewalBehavior: "NONE", active: true } });
  const price = await db.price.upsert({ where: { id: "certification-price" }, update: { active: true }, create: { id: "certification-price", productId: product.id, licensePolicyId: policy.id, name: "Certification", amountMinor: 1, currency: "PHP", billingType: "ONE_TIME", active: true } });
  await db.productVersion.upsert({ where: { productId_version: { productId: product.id, version: "1.0.0" } }, update: { active: true, isLatest: false }, create: { productId: product.id, version: "1.0.0", channel: "STABLE", lifecycle: "STABLE", operatingSystem: "linux", architecture: "x86_64", active: true, isLatest: false, publishedAt: new Date(), releasedAt: new Date(Date.now() - 10000) } });
  const v2 = await db.productVersion.upsert({ where: { productId_version: { productId: product.id, version: "2.0.0" } }, update: { active: true, isLatest: true, lifecycle: "STABLE", minimumSupportedVersion: "1.0.0" }, create: { productId: product.id, version: "2.0.0", channel: "STABLE", lifecycle: "STABLE", operatingSystem: "linux", architecture: "x86_64", active: true, isLatest: true, minimumSupportedVersion: "1.0.0", publishedAt: new Date(), releasedAt: new Date() } });
  const artifact = await db.productArtifact.upsert({ where: { objectKey: "certification/authority-product-v2.sh" }, update: { active: true, versionId: v2.id, sha256, sizeBytes: body.length }, create: { productId: product.id, versionId: v2.id, name: "authority-product-v2.sh", objectKey: "certification/authority-product-v2.sh", sha256, sizeBytes: body.length, contentType: "application/octet-stream", active: true } });
  const user = await db.user.upsert({ where: { email: "certification@example.invalid" }, update: {}, create: { email: "certification@example.invalid", name: "CI Certification" } });
  const account = await db.customerAccount.upsert({ where: { id: "certification-account" }, update: { lifecycleState: "ACTIVE" }, create: { id: "certification-account", type: "INDIVIDUAL", displayName: "CI Certification", ownerId: user.id, billingEmail: user.email, lifecycleState: "ACTIVE" } });
  const order = await db.order.upsert({ where: { number: "CERTIFICATION-UPDATE-2026" }, update: { status: "PAID", paidAt: new Date() }, create: { number: "CERTIFICATION-UPDATE-2026", accountId: account.id, status: "PAID", currency: "PHP", subtotalMinor: 0, taxMinor: 0, totalMinor: 0, billingSnapshot: {}, paidAt: new Date() } });
  const item = await db.orderItem.upsert({ where: { id: "certification-order-item" }, update: {}, create: { id: "certification-order-item", orderId: order.id, productId: product.id, priceId: price.id, policyId: policy.id, productName: product.name, priceName: price.name, quantity: 1, unitAmountMinor: 0, totalMinor: 0, billingType: "ONE_TIME", policySnapshot: {}, editionId: edition.id, purchasePlanId: plan.id, editionName: edition.name, planName: "Certification", planType: "PERPETUAL" } });
  await db.license.upsert({ where: { publicId: "certification-license" }, update: { status: "ACTIVE", expiresAt: null }, create: { publicId: "certification-license", keyHash: licenseHash, keyLastFour: "2026", accountId: account.id, orderId: order.id, orderItemId: item.id, productId: product.id, editionId: edition.id, purchasePlanId: plan.id, status: "ACTIVE", maxSeats: 1, maxDevicesPerSeat: 2 } });
  const storage = new S3Client({ region: process.env.S3_REGION ?? "us-east-1", endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
  try { await storage.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET! })); } catch {}
  await storage.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: artifact.objectKey, Body: body, ContentType: artifact.contentType }));
  process.stdout.write(JSON.stringify({ licenseKey, productId: product.id, artifactId: artifact.id, sha256, size: body.length }) + "\n");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
