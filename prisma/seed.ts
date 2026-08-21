import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const catalog = [
  { slug: "bke-deskflow", name: "BKE DeskFlow", summary: "Focused desktop operations for small teams.", description: "A dependable desktop toolkit for structured workflows, local reporting, and secure exports.", type: "SOFTWARE" as const, policy: { name: "Single User", maxSeats: 1, maxDevicesPerSeat: 2, validityDays: null }, price: { name: "Perpetual license", amountMinor: 149900, billingType: "ONE_TIME" as const }, edition: { slug: "professional", name: "Professional", features: ["Structured workflows", "Local reporting", "Secure exports"], maxUsers: 1, maxDevicesPerUser: 2, updatePolicy: "LIFETIME" as const, perpetual: 149900, monthly: null, annualDiscountBps: null } },
  { slug: "bke-cloudops", name: "BKE CloudOps", summary: "Shared SaaS operations with annual access.", description: "A secure hosted workspace for teams that need visibility, accountability, and reliable operational records.", type: "SAAS" as const, policy: { name: "Professional", maxSeats: 5, maxDevicesPerSeat: 3, validityDays: 365 }, price: { name: "Annual team plan", amountMinor: 299900, billingType: "SUBSCRIPTION" as const, intervalUnit: "YEAR" as const, intervalCount: 1 }, edition: { slug: "team", name: "Team", features: ["Shared workspace", "Operational audit trail", "Team reporting"], maxUsers: 5, maxDevicesPerUser: 3, updatePolicy: "ACTIVE_TERM" as const, perpetual: null, monthly: 29900, annualDiscountBps: 1000 } },
  { slug: "bke-institution-suite", name: "BKE Institution Suite", summary: "Flexible deployment for organizations and institutions.", description: "Organization licensing with authorized users, managed devices, and a central customer portal.", type: "HYBRID" as const, policy: { name: "Institution 25", maxSeats: 25, maxDevicesPerSeat: 2, validityDays: 365 }, price: { name: "Annual organization license", amountMinor: 1199900, billingType: "SUBSCRIPTION" as const, intervalUnit: "YEAR" as const, intervalCount: 1 }, edition: { slug: "institution", name: "Institution", features: ["25 authorized users", "Managed devices", "Central license portal"], maxUsers: 25, maxDevicesPerUser: 2, updatePolicy: "ACTIVE_TERM" as const, perpetual: 1199900, monthly: 109900, annualDiscountBps: 900 } },
];
const canonicalProductIds: Record<string, string> = { "bke-deskflow": "bke-deskflow", "bke-cloudops": "bke-cloudops", "bke-institution-suite": "bke-institution-suite" };
const legalTemplates = [
  ["TERMS_OF_SERVICE", "Terms of Service", "terms"],
  ["PRIVACY_POLICY", "Privacy Policy", "privacy"],
  ["SOFTWARE_LICENSE_AGREEMENT", "Software License Agreement (EULA)", "eula"],
  ["SUBSCRIPTION_TERMS", "Subscription Terms", "subscription"],
  ["REFUND_POLICY", "Refund Policy", "refund"],
  ["ACCEPTABLE_USE_POLICY", "Acceptable Use Policy", "acceptable-use"],
  ["COOKIE_POLICY", "Cookie Policy", "cookies"],
  ["SUPPORT_POLICY", "Support Policy", "support"],
  ["DATA_PROCESSING_ADDENDUM", "Data Processing Addendum", "dpa"],
] as const;

async function main() {
  for (const item of catalog) {
    const product = await db.product.upsert({
      where: { slug: item.slug },
      update: { productId: canonicalProductIds[item.slug], name: item.name, summary: item.summary, description: item.description, type: item.type, active: true, archivedAt: null },
      create: { productId: canonicalProductIds[item.slug], slug: item.slug, name: item.name, summary: item.summary, description: item.description, type: item.type, active: true, publishedAt: new Date() },
    });
    let policy = await db.licensePolicy.findFirst({ where: { productId: product.id, name: item.policy.name } });
    policy ??= await db.licensePolicy.create({ data: { productId: product.id, ...item.policy } });
    const legacyPrice = await db.price.findFirst({ where: { productId: product.id, name: item.price.name } })
      ?? await db.price.create({ data: { productId: product.id, licensePolicyId: policy.id, currency: "PHP", active: true, ...item.price } });

    const migratedPlan = await db.purchasePlan.findUnique({ where: { legacyPriceId: legacyPrice.id }, include: { edition: true } });
    const edition = migratedPlan
      ? await db.edition.update({ where: { id: migratedPlan.editionId }, data: { name: item.edition.name, features: item.edition.features, maxUsers: item.edition.maxUsers, maxDevicesPerUser: item.edition.maxDevicesPerUser, updatePolicy: item.edition.updatePolicy, active: true } })
      : await db.edition.upsert({
          where: { productId_slug: { productId: product.id, slug: item.edition.slug } },
          update: { name: item.edition.name, features: item.edition.features, maxUsers: item.edition.maxUsers, maxDevicesPerUser: item.edition.maxDevicesPerUser, updatePolicy: item.edition.updatePolicy, active: true },
          create: { productId: product.id, slug: item.edition.slug, name: item.edition.name, features: item.edition.features, maxUsers: item.edition.maxUsers, maxDevicesPerUser: item.edition.maxDevicesPerUser, updatePolicy: item.edition.updatePolicy },
        });
    if (migratedPlan) {
      await db.edition.updateMany({
        where: { productId: product.id, slug: item.edition.slug, id: { not: edition.id } },
        data: { active: false },
      });
      await db.edition.deleteMany({ where: { productId: product.id, slug: item.edition.slug, id: { not: edition.id }, purchasePlans: { none: {} }, licenses: { none: {} }, subscriptions: { none: {} }, trials: { none: {} } } });
    }

    const monthly = item.edition.monthly
      ? await db.purchasePlan.upsert({
          where: { editionId_type: { editionId: edition.id, type: "MONTHLY" } },
          update: { amountMinor: item.edition.monthly, currency: "PHP", renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
          create: { editionId: edition.id, type: "MONTHLY", amountMinor: item.edition.monthly, currency: "PHP", renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
        })
      : null;
    if (item.edition.perpetual) {
      await db.purchasePlan.upsert({
        where: { editionId_type: { editionId: edition.id, type: "PERPETUAL" } },
        update: { amountMinor: item.edition.perpetual, currency: "PHP", renewalBehavior: "NONE", active: true },
        create: { editionId: edition.id, type: "PERPETUAL", amountMinor: item.edition.perpetual, currency: "PHP", renewalBehavior: "NONE", active: true, legacyPriceId: item.price.billingType === "ONE_TIME" ? legacyPrice.id : undefined },
      });
    }
    if (monthly && item.edition.annualDiscountBps !== null) {
      await db.purchasePlan.upsert({
        where: { editionId_type: { editionId: edition.id, type: "ANNUAL" } },
        update: { amountMinor: null, annualDiscountBps: item.edition.annualDiscountBps, monthlySourcePlanId: monthly.id, currency: "PHP", renewalBehavior: "CUSTOMER_AUTHORIZED", active: true },
        create: { editionId: edition.id, type: "ANNUAL", amountMinor: null, annualDiscountBps: item.edition.annualDiscountBps, monthlySourcePlanId: monthly.id, currency: "PHP", renewalBehavior: "CUSTOMER_AUTHORIZED", active: true, legacyPriceId: item.price.billingType === "SUBSCRIPTION" ? legacyPrice.id : undefined },
      });
    }

    if (item.slug === "bke-cloudops") {
      const version = await db.productVersion.upsert({
        where: { productId_version: { productId: product.id, version: "1.0.0" } },
        update: { active: true, isLatest: true },
        create: { productId: product.id, version: "1.0.0", releaseNotes: "Initial stable release.", operatingSystem: "Any", architecture: "universal", active: true, isLatest: true, publishedAt: new Date() },
      });
      await db.productArtifact.upsert({
        where: { objectKey: "installers/bke-installer.bin" },
        update: { active: true, versionId: version.id },
        create: { productId: product.id, versionId: version.id, name: "BKE CloudOps Installer.bin", objectKey: "installers/bke-installer.bin", sha256: "523b125a5fba47594385b3d41c1bc474c58d9e0161ce5e731be7db8c5da95fd5", sizeBytes: 37, contentType: "application/octet-stream" },
      });
    }
  }
  for (const [documentType, title, slug] of legalTemplates) {
    const document = await db.legalDocument.upsert({ where: { slug }, update: { title, documentType, status: "ACTIVE" }, create: { title, slug, documentType } });
    const markdownContent = `# ${title}\n\nTemplate content for {{company_name}}. This placeholder must be reviewed and replaced before commercial launch.\n\n- Website: {{website}}\n- Support: {{support_email}}\n- Business address: {{business_address}}`;
    const version = await db.legalDocumentVersion.upsert({ where: { documentId_versionNumber: { documentId: document.id, versionNumber: 1 } }, update: {}, create: { documentId: document.id, versionNumber: 1, markdownContent, status: "PUBLISHED", effectiveAt: new Date(), publishedAt: new Date(), changeSummary: "Initial non-legal template", requiresReacceptance: false, contentHash: createHash("sha256").update(markdownContent).digest("hex") } });
    if (!document.currentPublishedVersionId) await db.legalDocument.update({ where: { id: document.id }, data: { currentPublishedVersionId: version.id } });
  }
  const compliance = [
    ["LEGAL_TERMS", "Terms of Service", "LEGAL", "PENDING_LAWYER_REVIEW", "Counsel must approve commercial terms and jurisdiction."],
    ["PRIVACY_DPA", "Privacy Policy and DPA", "PRIVACY", "PENDING_DPO_REVIEW", "DPO/privacy review must approve notices, rights, processors, and retention."],
    ["TAX_BIR", "Tax and BIR readiness", "TAX", "PENDING_ACCOUNTANT_REVIEW", "Accountant must confirm tax treatment, invoices, records, and BIR obligations."],
    ["SOFTWARE_LICENSE", "Software licensing terms", "LICENSING", "PENDING_LAWYER_REVIEW", "Counsel must approve EULA, editions, seats, renewals, and authorized users."],
    ["RETENTION", "Records retention schedule", "RETENTION", "PENDING_OWNER_DECISION", "Owner must approve periods before scheduler enforcement or purge."],
    ["PAYMENT_RECORDS", "Payment and refund evidence", "TAX", "IMPLEMENTED", "Immutable order, invoice, payment, refund, webhook, and audit records are retained."],
    ["CONSENT_EVIDENCE", "Consent evidence", "PRIVACY", "IMPLEMENTED", "Versioned legal acceptance records are immutable and auditable."],
  ] as const;
  for (const [key, title, category, status, description] of compliance) {
    await db.complianceRequirement.upsert({ where: { key }, update: { title, category, status, description }, create: { key, title, category, status, description } });
  }
  if (process.env.LOCAL_PRODUCTION_SIMULATION === "true") {
    const body = Buffer.from("BKE Digital Solutions test installer\n");
    const storage = new S3Client({ region: process.env.S3_REGION ?? "auto", endpoint: process.env.S3_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false", credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } });
    await storage.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: "installers/bke-installer.bin", Body: body, ContentType: "application/octet-stream" }));
  }
  console.info(`Seeded ${catalog.length} BKE Digital Solutions products and editions.`);
}

main().finally(() => db.$disconnect());
