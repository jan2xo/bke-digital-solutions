import "dotenv/config";

import { randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";
import { createArgon2PasswordHasher } from "@bke/identity/providers/argon2-password-hasher";
import {
  encryptLicenseKey,
  generateLicenseKey,
  hashLicenseKey,
} from "../platform/host/security/crypto";

const FIXTURE_EMAIL = "utm-launcher-customer@local.test";
const FIXTURE_ACCOUNT_ID = "utm-launcher-customer-account";
const PRODUCT_ID = "bke-render-dock";
const PRODUCT_SLUG = "bke-render-dock";
const PRODUCT_VERSION = "1.0.2";
const ORDER_NUMBER = "BKE-UTM-RENDER-DOCK";
const ORDER_ITEM_ID = "utm-render-dock-order-item";
const LICENSE_PUBLIC_ID = "utm-render-dock-license";
const ENTITLEMENT_SOURCE = "utm:render-dock:launcher-e2e";

function required(name: string, environment: NodeJS.ProcessEnv) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`UTM_FIXTURE_ENV_MISSING:${name}`);
  return value;
}

export function assertDisposableUtmFixtureEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (environment.BKE_DISPOSABLE_CERTIFICATION !== "true") {
    throw new Error("UTM_FIXTURE_REQUIRES_DISPOSABLE_CERTIFICATION");
  }
  if (environment.DEPLOYMENT_ENV !== "test") {
    throw new Error("UTM_FIXTURE_REQUIRES_TEST_DEPLOYMENT");
  }
  if (environment.APP_URL !== "https://bke-v3.test:8443") {
    throw new Error("UTM_FIXTURE_AUTHORITY_INVALID");
  }
  if (environment.PAYMENT_PROVIDER !== "mock" || environment.PAYMONGO_LIVEMODE !== "false") {
    throw new Error("UTM_FIXTURE_REQUIRES_MOCK_PAYMENTS");
  }
  if (environment.PAYMONGO_SECRET_KEY?.trim() || environment.PAYMONGO_WEBHOOK_SECRET?.trim()) {
    throw new Error("UTM_FIXTURE_REFUSES_PAYMONGO_SECRETS");
  }
  if (environment.EMAIL_PROVIDER !== "log" || environment.BKE_DISABLE_EXTERNAL_EMAIL !== "true") {
    throw new Error("UTM_FIXTURE_REQUIRES_DISABLED_EXTERNAL_EMAIL");
  }
  if (environment.RESEND_API_KEY?.trim()) {
    throw new Error("UTM_FIXTURE_REFUSES_RESEND_SECRET");
  }
  if (environment.CLAIM_CODE_CHECKOUT_ENABLED !== "false") {
    throw new Error("UTM_FIXTURE_REQUIRES_CLAIM_CODE_CHECKOUT_DISABLED");
  }
  if (environment.AGENT_ACCOUNT_SESSION_ENABLED !== "true") {
    throw new Error("UTM_FIXTURE_REQUIRES_AGENT_ACCOUNT_SESSION");
  }
  required("DATABASE_URL", environment);
  required("LICENSE_PEPPER", environment);
}

function generateFixturePassword() {
  return `BKE-UTM-${randomBytes(18).toString("base64url")}!`;
}

async function seedFixture(environment: NodeJS.ProcessEnv = process.env) {
  assertDisposableUtmFixtureEnvironment(environment);

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: required("DATABASE_URL", environment) }),
  });
  const passwordHasher = createArgon2PasswordHasher();
  const password = generateFixturePassword();
  const passwordHash = await passwordHasher.hash(password);
  const now = new Date();
  const validFrom = new Date(now.getTime() - 60_000);

  try {
    const user = await db.user.upsert({
      where: { email: FIXTURE_EMAIL },
      update: {
        name: "UTM Launcher Customer",
        role: "CUSTOMER",
        lifecycleState: "ACTIVE",
        suspendedAt: null,
        emailVerified: now,
      },
      create: {
        email: FIXTURE_EMAIL,
        name: "UTM Launcher Customer",
        role: "CUSTOMER",
        lifecycleState: "ACTIVE",
        emailVerified: now,
      },
    });

    await db.passwordCredential.upsert({
      where: { userId: user.id },
      update: { passwordHash, changedAt: now },
      create: { userId: user.id, passwordHash, changedAt: now },
    });

    const account = await db.customerAccount.upsert({
      where: { id: FIXTURE_ACCOUNT_ID },
      update: {
        ownerId: user.id,
        type: "INDIVIDUAL",
        displayName: "UTM Launcher Customer",
        billingEmail: FIXTURE_EMAIL,
        lifecycleState: "ACTIVE",
        closureRequestedAt: null,
        closedAt: null,
        privacyRequestedAt: null,
      },
      create: {
        id: FIXTURE_ACCOUNT_ID,
        ownerId: user.id,
        type: "INDIVIDUAL",
        displayName: "UTM Launcher Customer",
        billingEmail: FIXTURE_EMAIL,
        lifecycleState: "ACTIVE",
      },
    });

    const ownedAccounts = await db.customerAccount.count({ where: { ownerId: user.id } });
    const memberships = await db.membership.count({ where: { userId: user.id } });
    if (ownedAccounts !== 1 || memberships !== 0) {
      throw new Error("UTM_FIXTURE_CUSTOMER_ACCOUNT_SELECTION_NOT_DETERMINISTIC");
    }

    const existingProduct = await db.product.findFirst({
      where: {
        OR: [
          { productId: PRODUCT_ID },
          { slug: PRODUCT_SLUG },
        ],
      },
    });

    const product = existingProduct
      ? await db.product.update({
          where: { id: existingProduct.id },
          data: {
            productId: PRODUCT_ID,
            slug: PRODUCT_SLUG,
            name: "Render Dock",
            summary: "BKE Render Dock broadcast rendering software.",
            description: "Disposable UTM launcher certification fixture.",
            type: "SOFTWARE",
            launcherExecutionType: "STANDALONE",
            active: true,
            publishedAt: existingProduct.publishedAt ?? now,
            archivedAt: null,
          },
        })
      : await db.product.create({
          data: {
            productId: PRODUCT_ID,
            slug: PRODUCT_SLUG,
            name: "Render Dock",
            summary: "BKE Render Dock broadcast rendering software.",
            description: "Disposable UTM launcher certification fixture.",
            type: "SOFTWARE",
            launcherExecutionType: "STANDALONE",
            active: true,
            publishedAt: now,
          },
        });

    const version = await db.productVersion.upsert({
      where: {
        productId_version: {
          productId: product.id,
          version: PRODUCT_VERSION,
        },
      },
      update: {
        releaseNotes: "Disposable UTM certification target.",
        operatingSystem: "Windows",
        architecture: "universal",
        channel: "STABLE",
        lifecycle: "STABLE",
        active: true,
        isLatest: true,
        publishedAt: now,
      },
      create: {
        productId: product.id,
        version: PRODUCT_VERSION,
        releaseNotes: "Disposable UTM certification target.",
        operatingSystem: "Windows",
        architecture: "universal",
        channel: "STABLE",
        lifecycle: "STABLE",
        active: true,
        isLatest: true,
        publishedAt: now,
      },
    });

    await db.productVersion.updateMany({
      where: {
        productId: product.id,
        id: { not: version.id },
      },
      data: { isLatest: false },
    });

    let policy = await db.licensePolicy.findFirst({
      where: { productId: product.id, name: "UTM Single User" },
    });
    policy ??= await db.licensePolicy.create({
      data: {
        productId: product.id,
        name: "UTM Single User",
        maxSeats: 1,
        maxDevicesPerSeat: 2,
        validityDays: null,
      },
    });

    const edition = await db.edition.upsert({
      where: {
        productId_slug: {
          productId: product.id,
          slug: "utm",
        },
      },
      update: {
        name: "UTM",
        description: "Disposable UTM certification edition.",
        features: ["Launcher managed standalone install"],
        maxUsers: 1,
        maxDevicesPerUser: 2,
        updatePolicy: "LIFETIME",
        active: true,
      },
      create: {
        productId: product.id,
        slug: "utm",
        name: "UTM",
        description: "Disposable UTM certification edition.",
        features: ["Launcher managed standalone install"],
        maxUsers: 1,
        maxDevicesPerUser: 2,
        updatePolicy: "LIFETIME",
        active: true,
      },
    });

    const plan = await db.purchasePlan.upsert({
      where: {
        editionId_type: {
          editionId: edition.id,
          type: "PERPETUAL",
        },
      },
      update: {
        amountMinor: 1,
        currency: "PHP",
        renewalBehavior: "NONE",
        active: true,
      },
      create: {
        editionId: edition.id,
        type: "PERPETUAL",
        amountMinor: 1,
        currency: "PHP",
        renewalBehavior: "NONE",
        active: true,
      },
    });

    let price = await db.price.findFirst({
      where: {
        productId: product.id,
        name: "UTM Render Dock",
      },
    });
    price = price
      ? await db.price.update({
          where: { id: price.id },
          data: {
            licensePolicyId: policy.id,
            amountMinor: 1,
            currency: "PHP",
            billingType: "ONE_TIME",
            active: true,
          },
        })
      : await db.price.create({
          data: {
            productId: product.id,
            licensePolicyId: policy.id,
            name: "UTM Render Dock",
            amountMinor: 1,
            currency: "PHP",
            billingType: "ONE_TIME",
            active: true,
          },
        });

    const order = await db.order.upsert({
      where: { number: ORDER_NUMBER },
      update: {
        accountId: account.id,
        status: "PAID",
        currency: "PHP",
        subtotalMinor: 1,
        taxMinor: 0,
        totalMinor: 1,
        billingSnapshot: {
          name: account.displayName,
          email: FIXTURE_EMAIL,
          fixture: "utm-launcher-e2e",
        },
        paidAt: now,
      },
      create: {
        number: ORDER_NUMBER,
        accountId: account.id,
        status: "PAID",
        currency: "PHP",
        subtotalMinor: 1,
        taxMinor: 0,
        totalMinor: 1,
        billingSnapshot: {
          name: account.displayName,
          email: FIXTURE_EMAIL,
          fixture: "utm-launcher-e2e",
        },
        paidAt: now,
      },
    });

    const item = await db.orderItem.upsert({
      where: { id: ORDER_ITEM_ID },
      update: {
        orderId: order.id,
        productId: product.id,
        priceId: price.id,
        policyId: policy.id,
        productName: product.name,
        priceName: price.name,
        quantity: 1,
        unitAmountMinor: 1,
        totalMinor: 1,
        billingType: "ONE_TIME",
        policySnapshot: {
          maxSeats: 1,
          maxDevicesPerSeat: 2,
          validityDays: null,
        },
        editionId: edition.id,
        purchasePlanId: plan.id,
        editionName: edition.name,
        planName: "UTM Perpetual",
        planType: "PERPETUAL",
        renewalBehavior: "NONE",
        entitlementSnapshot: {
          subjectId: account.id,
          resourceId: edition.id,
        },
        pricingSnapshot: {
          testOnly: true,
          fixture: "utm-launcher-e2e",
        },
        catalogAmountMinor: 1,
      },
      create: {
        id: ORDER_ITEM_ID,
        orderId: order.id,
        productId: product.id,
        priceId: price.id,
        policyId: policy.id,
        productName: product.name,
        priceName: price.name,
        quantity: 1,
        unitAmountMinor: 1,
        totalMinor: 1,
        billingType: "ONE_TIME",
        policySnapshot: {
          maxSeats: 1,
          maxDevicesPerSeat: 2,
          validityDays: null,
        },
        editionId: edition.id,
        purchasePlanId: plan.id,
        editionName: edition.name,
        planName: "UTM Perpetual",
        planType: "PERPETUAL",
        renewalBehavior: "NONE",
        entitlementSnapshot: {
          subjectId: account.id,
          resourceId: edition.id,
        },
        pricingSnapshot: {
          testOnly: true,
          fixture: "utm-launcher-e2e",
        },
        catalogAmountMinor: 1,
      },
    });

    const plaintextLicenseKey = generateLicenseKey();
    const existingLicense = await db.license.findUnique({
      where: { orderItemId: item.id },
    });
    const license = existingLicense
      ? await db.license.update({
          where: { id: existingLicense.id },
          data: {
            publicId: LICENSE_PUBLIC_ID,
            keyHash: hashLicenseKey(plaintextLicenseKey),
            keyLastFour: plaintextLicenseKey.slice(-4),
            keyCiphertext: encryptLicenseKey(plaintextLicenseKey),
            accountId: account.id,
            orderId: order.id,
            productId: product.id,
            editionId: edition.id,
            purchasePlanId: plan.id,
            status: "ACTIVE",
            maxSeats: 1,
            maxDevicesPerSeat: 2,
            expiresAt: null,
          },
        })
      : await db.license.create({
          data: {
            publicId: LICENSE_PUBLIC_ID,
            keyHash: hashLicenseKey(plaintextLicenseKey),
            keyLastFour: plaintextLicenseKey.slice(-4),
            keyCiphertext: encryptLicenseKey(plaintextLicenseKey),
            accountId: account.id,
            orderId: order.id,
            orderItemId: item.id,
            productId: product.id,
            editionId: edition.id,
            purchasePlanId: plan.id,
            status: "ACTIVE",
            maxSeats: 1,
            maxDevicesPerSeat: 2,
          },
        });

    const entitlementId = randomUUID();
    await db.$executeRaw`
      INSERT INTO "Entitlement" (
        "id", "subjectId", "resourceId", "sourceReference", "status", "quantity",
        "scopeSnapshot", "grantSnapshot", "validFrom", "validUntil"
      ) VALUES (
        ${entitlementId}, ${account.id}, ${edition.id}, ${ENTITLEMENT_SOURCE}, 'ACTIVE', 1,
        ${JSON.stringify({ productId: PRODUCT_ID, editionId: edition.id, testOnly: true })}::jsonb,
        ${JSON.stringify({ source: "utm-launcher-e2e", orderId: order.id, licenseId: license.id })}::jsonb,
        ${validFrom}, NULL
      )
      ON CONFLICT ("sourceReference") DO UPDATE SET
        "subjectId" = EXCLUDED."subjectId",
        "resourceId" = EXCLUDED."resourceId",
        "status" = 'ACTIVE',
        "quantity" = 1,
        "scopeSnapshot" = EXCLUDED."scopeSnapshot",
        "grantSnapshot" = EXCLUDED."grantSnapshot",
        "validFrom" = EXCLUDED."validFrom",
        "validUntil" = NULL
    `;

    console.info(JSON.stringify({
      testOnly: true,
      fixture: "utm-launcher-e2e",
      email: FIXTURE_EMAIL,
      password,
      accountId: account.id,
      productId: PRODUCT_ID,
      version: PRODUCT_VERSION,
      entitled: true,
      launcherExecutionType: "STANDALONE",
      releaseRepository: "jan2xo/BKE_RENDER_DOCK",
      releaseTag: "v1.0.2",
    }));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  seedFixture().catch((error) => {
    console.error(error instanceof Error ? error.message : "UTM_FIXTURE_FAILED");
    process.exitCode = 1;
  });
}
