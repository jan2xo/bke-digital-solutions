import assert from "node:assert/strict";
import { db } from "@/platform/host/db";
import {
  issueAgentLicenseDeviceManagementHandle,
  issueAgentLicenseDeviceTargetHandle,
  resolveAgentLicenseDeviceManagementHandle,
  resolveAgentLicenseDeviceTargetHandle,
} from "@/apps/web/licensing/agent-license-device-management";
import {
  deactivateAgentLicenseDevice,
  getAgentLicenseDeviceOverview,
} from "@/apps/web/licensing/agent-license-device-authority";

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

const owner = await makeUser("device-owner");
const licenseManager = await makeUser("device-license-manager");
const member = await makeUser("device-member");
const outsider = await makeUser("device-outsider");

const organization = await db.customerAccount.create({
  data: {
    type: "ORGANIZATION",
    displayName: "Device Certification Organization",
    ownerId: owner.id,
    billingEmail: owner.email,
    organization: {
      create: {
        legalName: "Device Certification Organization Legal",
      },
    },
    memberships: {
      create: [
        {
          userId: licenseManager.id,
          role: "LICENSE_MANAGER",
        },
        {
          userId: member.id,
          role: "MEMBER",
        },
      ],
    },
  },
});

const otherAccount = await db.customerAccount.create({
  data: {
    type: "INDIVIDUAL",
    displayName: "Device Other Account",
    ownerId: outsider.id,
    billingEmail: outsider.email,
  },
});

const product = await db.product.create({
  data: {
    slug: `device-cert-${suffix}`,
    productId: `bke-device-cert-${suffix}`,
    name: "Device Certification Product",
    summary: "Certification summary",
    description: "Certification description",
    type: "SOFTWARE",
    publishedAt: new Date(),
    editions: {
      create: {
        slug: "pro",
        name: "Pro",
        maxUsers: 1,
        maxDevicesPerUser: 3,
        purchasePlans: {
          create: {
            type: "PERPETUAL",
            currency: "PHP",
            amountMinor: 100000,
            renewalBehavior: "NONE",
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
    number: `ORD-DEVICE-${suffix}`,
    accountId: organization.id,
    status: "PAID",
    currency: "PHP",
    subtotalMinor: 100000,
    taxMinor: 0,
    totalMinor: 100000,
    billingSnapshot: { certification: true },
    paidAt: new Date(),
    items: {
      create: {
        productId: product.id,
        priceId: `price-device-${suffix}`,
        policyId: `policy-device-${suffix}`,
        productName: product.name,
        priceName: "Perpetual",
        quantity: 1,
        unitAmountMinor: 100000,
        totalMinor: 100000,
        billingType: "ONE_TIME",
        policySnapshot: { certification: true },
        editionId: edition.id,
        purchasePlanId: purchasePlan.id,
        editionName: edition.name,
        planName: "Perpetual",
        planType: "PERPETUAL",
        renewalBehavior: "NONE",
      },
    },
  },
  include: { items: true },
});

const license = await db.license.create({
  data: {
    publicId: `LIC-DEVICE-${suffix}`,
    keyHash: `device-key-hash-${suffix}`,
    keyLastFour: "D001",
    accountId: organization.id,
    orderId: order.id,
    orderItemId: order.items[0]!.id,
    productId: product.id,
    editionId: edition.id,
    purchasePlanId: purchasePlan.id,
    status: "ACTIVE",
    maxSeats: 1,
    maxDevicesPerSeat: 3,
    activations: {
      create: [
        {
          deviceHash: `active-device-hash-${suffix}`,
          label: "Studio workstation",
          machineIdHint: `machine-hint-secret-${suffix}`,
          operatingSystem: "Windows 11",
          architecture: "ARM64",
          lastSeenAt: new Date("2026-09-30T12:00:00.000Z"),
          activatedAt: new Date("2026-09-29T12:00:00.000Z"),
        },
        {
          deviceHash: `inactive-device-hash-${suffix}`,
          label: "Retired workstation",
          machineIdHint: `retired-machine-hint-secret-${suffix}`,
          operatingSystem: "Windows 11",
          architecture: "x64",
          active: false,
          deactivatedAt: new Date("2026-09-28T12:00:00.000Z"),
          lastSeenAt: new Date("2026-09-28T11:00:00.000Z"),
          activatedAt: new Date("2026-09-20T12:00:00.000Z"),
        },
      ],
    },
  },
  include: {
    activations: {
      orderBy: { activatedAt: "asc" },
    },
  },
});

try {
  const active = license.activations.find(
    (activation) => activation.active,
  )!;
  const inactive = license.activations.find(
    (activation) => !activation.active,
  )!;

  const licenseHandle =
    issueAgentLicenseDeviceManagementHandle(
      organization.id,
      license.id,
      license.createdAt,
    );
  const activeHandle =
    issueAgentLicenseDeviceTargetHandle(
      organization.id,
      license.id,
      active.id,
      active.activatedAt,
    );

  assert.equal(
    await resolveAgentLicenseDeviceManagementHandle({
      accountId: organization.id,
      handle: licenseHandle,
    }),
    license.id,
  );
  assert.equal(
    await resolveAgentLicenseDeviceManagementHandle({
      accountId: otherAccount.id,
      handle: licenseHandle,
    }),
    null,
  );
  assert.equal(
    await resolveAgentLicenseDeviceTargetHandle({
      accountId: organization.id,
      licenseId: license.id,
      handle: activeHandle,
    }),
    active.id,
  );
  assert.equal(
    await resolveAgentLicenseDeviceTargetHandle({
      accountId: otherAccount.id,
      licenseId: license.id,
      handle: activeHandle,
    }),
    null,
  );

  const overview = await getAgentLicenseDeviceOverview({
    principalId: licenseManager.id,
    accountId: organization.id,
    licenseId: license.id,
  });
  assert.equal(overview.status, "ready");
  if (overview.status !== "ready") {
    throw new Error("device overview missing");
  }

  assert.deepEqual(overview.license, {
    productName: product.name,
    editionName: edition.name,
    keyLastFour: "D001",
    maxDevices: 3,
    activeDevices: 1,
  });
  assert.equal(overview.devices.length, 2);

  const activeProjection = overview.devices.find(
    (device) => device.active,
  );
  const inactiveProjection = overview.devices.find(
    (device) => !device.active,
  );
  assert.ok(activeProjection);
  assert.ok(inactiveProjection);
  assert.equal(
    activeProjection.managementHandle?.startsWith(
      "bke-license-device-target-v1_",
    ),
    true,
  );
  assert.equal(inactiveProjection.managementHandle, null);
  assert.equal(activeProjection.operatingSystem, "Windows 11");
  assert.equal(activeProjection.architecture, "ARM64");

  const denied = await getAgentLicenseDeviceOverview({
    principalId: member.id,
    accountId: organization.id,
    licenseId: license.id,
  });
  assert.deepEqual(denied, {
    status: "account_forbidden",
  });

  const wire = JSON.stringify(overview);
  for (const forbidden of [
    organization.id,
    otherAccount.id,
    license.id,
    active.id,
    inactive.id,
    active.deviceHash,
    inactive.deviceHash,
    active.machineIdHint!,
    inactive.machineIdHint!,
    product.id,
    edition.id,
    order.id,
  ]) {
    assert.equal(wire.includes(forbidden), false);
  }

  const deactivated = await deactivateAgentLicenseDevice({
    principalId: licenseManager.id,
    accountId: organization.id,
    licenseId: license.id,
    deviceActivationId: active.id,
  });
  assert.deepEqual(deactivated, {
    status: "deactivated",
  });

  const persisted =
    await db.deviceActivation.findUniqueOrThrow({
      where: { id: active.id },
    });
  assert.equal(persisted.active, false);
  assert.ok(persisted.deactivatedAt);

  const event = await db.licenseEvent.findFirst({
    where: {
      licenseId: license.id,
      type: "DEACTIVATED",
    },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(event);
  assert.equal(
    (event.metadata as { deviceHash?: string }).deviceHash,
    active.deviceHash,
  );

  const audit = await db.auditLog.findFirst({
    where: {
      actorId: licenseManager.id,
      accountId: organization.id,
      action: "DEVICE_DEACTIVATED",
      targetType: "DeviceActivation",
      targetId: active.id,
    },
  });
  assert.ok(audit);

  assert.deepEqual(
    await deactivateAgentLicenseDevice({
      principalId: licenseManager.id,
      accountId: organization.id,
      licenseId: license.id,
      deviceActivationId: active.id,
    }),
    { status: "device_not_found" },
  );

  await db.customerAccount.update({
    where: { id: organization.id },
    data: { lifecycleState: "SUSPENDED" },
  });
  assert.deepEqual(
    await getAgentLicenseDeviceOverview({
      principalId: owner.id,
      accountId: organization.id,
      licenseId: license.id,
    }),
    { status: "account_not_active" },
  );

  console.log(
    "Agent-session license device management certification: PASS",
  );
} finally {
  await db.auditLog.deleteMany({
    where: { accountId: organization.id },
  });
  await db.deviceActivation.deleteMany({
    where: { licenseId: license.id },
  });
  await db.license.deleteMany({
    where: { accountId: organization.id },
  });
  await db.order.deleteMany({
    where: { accountId: organization.id },
  });
  await db.customerAccount.deleteMany({
    where: {
      id: {
        in: [organization.id, otherAccount.id],
      },
    },
  });
  await db.product.deleteMany({
    where: { id: product.id },
  });
  await db.user.deleteMany({
    where: {
      id: {
        in: [
          owner.id,
          licenseManager.id,
          member.id,
          outsider.id,
        ],
      },
    },
  });
}
