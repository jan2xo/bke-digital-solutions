import assert from "node:assert/strict";
import { db } from "@/platform/host/db";
import { getAgentAccountPurchasesOverview } from "@/apps/web/accounts/agent-account-purchases-overview";

const suffix = `${Date.now().toString(36)}-${process.pid}`;

async function makeUser(label: string) {
  return db.user.create({
    data: {
      email: `${label}-${suffix}@bke.test`,
      name: label,
      emailVerified: new Date(),
    },
  });
}

const owner = await makeUser("purchases-owner");
const billing = await makeUser("purchases-billing");
const licenseManager = await makeUser("purchases-license");
const member = await makeUser("purchases-member");
const outsider = await makeUser("purchases-outsider");

const organization = await db.customerAccount.create({
  data: {
    type: "ORGANIZATION",
    displayName: "Purchases Certification Organization",
    ownerId: owner.id,
    billingEmail: owner.email,
    organization: {
      create: {
        legalName: "Purchases Certification Organization Legal",
      },
    },
    memberships: {
      create: [
        { userId: owner.id, role: "OWNER" },
        { userId: billing.id, role: "BILLING" },
        { userId: licenseManager.id, role: "LICENSE_MANAGER" },
        { userId: member.id, role: "MEMBER" },
      ],
    },
  },
});

const product = await db.product.create({
  data: {
    slug: `purchases-cert-${suffix}`,
    productId: `bke-purchases-cert-${suffix}`,
    name: "Purchases Certification Product",
    summary: "Certification summary",
    description: "Certification description",
    type: "SOFTWARE",
    publishedAt: new Date(),
    editions: {
      create: {
        slug: "pro",
        name: "Pro",
        maxUsers: 2,
        maxDevicesPerUser: 2,
        purchasePlans: {
          create: {
            type: "MONTHLY",
            currency: "PHP",
            amountMinor: 30000000,
            renewalBehavior: "CUSTOMER_AUTHORIZED",
          },
        },
      },
    },
  },
  include: {
    editions: {
      include: { purchasePlans: true },
    },
  },
});

const edition = product.editions[0]!;
const purchasePlan = edition.purchasePlans[0]!;

const order = await db.order.create({
  data: {
    number: `ORD-PURCHASES-${suffix}`,
    accountId: organization.id,
    status: "PAID",
    currency: "PHP",
    subtotalMinor: 30000000,
    taxMinor: 0,
    totalMinor: 30000000,
    billingSnapshot: { certification: true },
    paidAt: new Date(),
    items: {
      create: [
        {
          productId: product.id,
          priceId: `price-a-${suffix}`,
          policyId: `policy-a-${suffix}`,
          productName: product.name,
          priceName: "Annual",
          quantity: 1,
          unitAmountMinor: 30000000,
          totalMinor: 30000000,
          billingType: "SUBSCRIPTION",
          policySnapshot: { certification: true },
          editionId: edition.id,
          purchasePlanId: purchasePlan.id,
          editionName: edition.name,
          planName: "Monthly",
          planType: "MONTHLY",
          intervalUnit: "MONTH",
          intervalCount: 1,
          renewalBehavior: "CUSTOMER_AUTHORIZED",
        },
        {
          productId: product.id,
          priceId: `price-b-${suffix}`,
          policyId: `policy-b-${suffix}`,
          productName: product.name,
          priceName: "Annual second seat",
          quantity: 1,
          unitAmountMinor: 0,
          totalMinor: 0,
          billingType: "SUBSCRIPTION",
          policySnapshot: { certification: true },
          editionId: edition.id,
          purchasePlanId: purchasePlan.id,
          editionName: edition.name,
          planName: "Monthly",
          planType: "MONTHLY",
          intervalUnit: "MONTH",
          intervalCount: 1,
          renewalBehavior: "CUSTOMER_AUTHORIZED",
        },
      ],
    },
    invoice: {
      create: {
        number: `INV-PURCHASES-${suffix}`,
        status: "FINAL",
        customerSnapshot: { certification: true },
        currency: "PHP",
        subtotalMinor: 30000000,
        taxMinor: 0,
        totalMinor: 30000000,
        issuedAt: new Date(),
      },
    },
  },
  include: { items: true },
});

const pendingOrder = await db.order.create({
  data: {
    number: `ORD-PENDING-${suffix}`,
    accountId: organization.id,
    status: "PENDING",
    currency: "PHP",
    subtotalMinor: 15000000,
    taxMinor: 0,
    totalMinor: 15000000,
    billingSnapshot: { certification: true },
  },
});

const subscription = await db.subscription.create({
  data: {
    accountId: organization.id,
    orderId: order.id,
    productId: product.id,
    editionId: edition.id,
    purchasePlanId: purchasePlan.id,
    status: "ACTIVE",
    seats: 2,
    currentPeriodStart: new Date("2026-09-30T00:00:00.000Z"),
    currentPeriodEnd: new Date("2027-09-30T00:00:00.000Z"),
    renewalReminderAt: new Date("2027-09-01T00:00:00.000Z"),
    currency: "PHP",
    normalRecurringAmountMinor: 30000000,
  },
});

const assignedLicense = await db.license.create({
  data: {
    publicId: `LIC-A-${suffix}`,
    keyHash: `key-hash-a-${suffix}`,
    keyLastFour: "A001",
    accountId: organization.id,
    orderId: order.id,
    orderItemId: order.items[0]!.id,
    productId: product.id,
    editionId: edition.id,
    purchasePlanId: purchasePlan.id,
    subscriptionId: subscription.id,
    status: "ACTIVE",
    maxSeats: 2,
    maxDevicesPerSeat: 2,
    expiresAt: new Date("2027-09-30T00:00:00.000Z"),
    assignments: {
      create: { userId: member.id },
    },
    activations: {
      create: {
        deviceHash: `device-a-${suffix}`,
        label: "Member workstation",
      },
    },
  },
});

await db.license.create({
  data: {
    publicId: `LIC-B-${suffix}`,
    keyHash: `key-hash-b-${suffix}`,
    keyLastFour: "B002",
    accountId: organization.id,
    orderId: order.id,
    orderItemId: order.items[1]!.id,
    productId: product.id,
    editionId: edition.id,
    purchasePlanId: purchasePlan.id,
    status: "ACTIVE",
    maxSeats: 1,
    maxDevicesPerSeat: 1,
  },
});

try {
  const ownerOverview =
    await getAgentAccountPurchasesOverview({
      principalId: owner.id,
      accountId: organization.id,
    });
  assert.equal(ownerOverview.status, "ready");
  if (ownerOverview.status !== "ready") {
    throw new Error("owner purchases overview missing");
  }
  assert.deepEqual(ownerOverview.permissions, {
    viewOrders: true,
    viewSubscriptions: true,
    viewAllLicenses: true,
    manageLicenseSeats: true,
    manageDevices: true,
    continuePendingOrders: true,
    cancelPendingOrders: true,
  });
  assert.equal(ownerOverview.licenses.length, 2);
  assert.ok(
    ownerOverview.licenses.every(
      (license) =>
        license.seatManagementHandle?.startsWith(
          "bke-license-seat-v1_",
        ) === true &&
        license.deviceManagementHandle?.startsWith(
          "bke-license-device-v1_",
        ) === true,
    ),
  );
  assert.equal(
    ownerOverview.licenses.find(
      (license) => license.keyLastFour === "A001",
    )?.assignedSeats,
    1,
  );
  assert.equal(ownerOverview.subscriptions.length, 1);
  assert.equal(ownerOverview.orders.length, 2);
  const ownerPendingOrder = ownerOverview.orders.find(
    (candidate) => candidate.status === "PENDING",
  );
  const ownerPaidOrder = ownerOverview.orders.find(
    (candidate) => candidate.status === "PAID",
  );
  assert.ok(ownerPendingOrder);
  assert.ok(ownerPaidOrder);
  assert.equal(ownerPaidOrder.invoiceAvailable, true);
  assert.equal(ownerPaidOrder.items.length, 2);
  assert.equal(
    ownerPendingOrder.continueHandle?.startsWith(
      "bke-order-continue-v1_",
    ),
    true,
  );
  assert.equal(
    ownerPendingOrder.cancelHandle?.startsWith(
      "bke-order-cancel-v1_",
    ),
    true,
  );
  assert.equal(ownerPaidOrder.continueHandle, null);
  assert.equal(ownerPaidOrder.cancelHandle, null);
  assert.equal(
    ownerPendingOrder.continueHandle?.includes(
      pendingOrder.id,
    ),
    false,
  );
  assert.equal(
    ownerPendingOrder.cancelHandle?.includes(
      pendingOrder.id,
    ),
    false,
  );
  assert.equal(
    Object.hasOwn(ownerOverview.licenses[0] ?? {}, "id"),
    false,
  );
  assert.equal(
    Object.hasOwn(ownerOverview.orders[0] ?? {}, "id"),
    false,
  );
  assert.equal(
    Object.hasOwn(ownerOverview.subscriptions[0] ?? {}, "id"),
    false,
  );

  const billingOverview =
    await getAgentAccountPurchasesOverview({
      principalId: billing.id,
      accountId: organization.id,
    });
  assert.equal(billingOverview.status, "ready");
  if (billingOverview.status !== "ready") {
    throw new Error("billing purchases overview missing");
  }
  assert.deepEqual(billingOverview.permissions, {
    viewOrders: true,
    viewSubscriptions: true,
    viewAllLicenses: false,
    manageLicenseSeats: false,
    manageDevices: false,
    continuePendingOrders: true,
    cancelPendingOrders: true,
  });
  assert.equal(billingOverview.licenses.length, 0);
  assert.equal(billingOverview.subscriptions.length, 1);
  assert.equal(billingOverview.orders.length, 2);
  const billingPendingOrder = billingOverview.orders.find(
    (candidate) => candidate.status === "PENDING",
  );
  assert.ok(billingPendingOrder);
  assert.ok(billingPendingOrder.continueHandle);
  assert.ok(billingPendingOrder.cancelHandle);

  const licenseOverview =
    await getAgentAccountPurchasesOverview({
      principalId: licenseManager.id,
      accountId: organization.id,
    });
  assert.equal(licenseOverview.status, "ready");
  if (licenseOverview.status !== "ready") {
    throw new Error("license-manager purchases overview missing");
  }
  assert.deepEqual(licenseOverview.permissions, {
    viewOrders: false,
    viewSubscriptions: true,
    viewAllLicenses: true,
    manageLicenseSeats: true,
    manageDevices: true,
    continuePendingOrders: false,
    cancelPendingOrders: false,
  });
  assert.equal(licenseOverview.licenses.length, 2);
  assert.ok(
    licenseOverview.licenses.every(
      (license) =>
        license.seatManagementHandle?.startsWith(
          "bke-license-seat-v1_",
        ) === true &&
        license.deviceManagementHandle?.startsWith(
          "bke-license-device-v1_",
        ) === true,
    ),
  );
  assert.equal(licenseOverview.subscriptions.length, 1);
  assert.equal(licenseOverview.orders.length, 0);

  const memberOverview =
    await getAgentAccountPurchasesOverview({
      principalId: member.id,
      accountId: organization.id,
    });
  assert.equal(memberOverview.status, "ready");
  if (memberOverview.status !== "ready") {
    throw new Error("member purchases overview missing");
  }
  assert.deepEqual(memberOverview.permissions, {
    viewOrders: false,
    viewSubscriptions: false,
    viewAllLicenses: false,
    manageLicenseSeats: false,
    manageDevices: false,
    continuePendingOrders: false,
    cancelPendingOrders: false,
  });
  assert.equal(memberOverview.licenses.length, 1);
  assert.equal(
    memberOverview.licenses[0]!.keyLastFour,
    assignedLicense.keyLastFour,
  );
  assert.equal(
    memberOverview.licenses[0]!.seatManagementHandle,
    null,
  );
  assert.equal(
    memberOverview.licenses[0]!.deviceManagementHandle,
    null,
  );
  assert.equal(memberOverview.subscriptions.length, 0);
  assert.equal(memberOverview.orders.length, 0);

  const outsiderOverview =
    await getAgentAccountPurchasesOverview({
      principalId: outsider.id,
      accountId: organization.id,
    });
  assert.deepEqual(
    outsiderOverview,
    { status: "forbidden" },
  );

  console.log(
    "Agent-session account purchases overview certification: PASS",
  );
} finally {
  await db.deviceActivation.deleteMany({
    where: { license: { accountId: organization.id } },
  });
  await db.licenseAssignment.deleteMany({
    where: { license: { accountId: organization.id } },
  });
  await db.license.deleteMany({
    where: { accountId: organization.id },
  });
  await db.subscription.deleteMany({
    where: { accountId: organization.id },
  });
  await db.invoice.deleteMany({
    where: { order: { accountId: organization.id } },
  });
  await db.order.deleteMany({
    where: { accountId: organization.id },
  });
  await db.customerAccount.deleteMany({
    where: { id: organization.id },
  });
  await db.product.deleteMany({
    where: { id: product.id },
  });
  await db.user.deleteMany({
    where: {
      id: {
        in: [
          owner.id,
          billing.id,
          licenseManager.id,
          member.id,
          outsider.id,
        ],
      },
    },
  });
}
