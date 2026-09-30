import assert from "node:assert/strict";
import { db } from "@/platform/host/db";
import {
  assignLicenseSeat,
  removeLicenseSeat,
} from "@/apps/web/licensing/license-seat-management";
import {
  issueAgentLicenseSeatManagementHandle,
  issueAgentLicenseSeatTargetHandle,
  resolveAgentLicenseSeatManagementHandle,
  resolveAgentLicenseSeatTargetHandle,
} from "@/apps/web/licensing/agent-license-seat-management";
import { getAgentLicenseSeatOverview } from "@/apps/web/licensing/agent-license-seat-overview";

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

const owner = await makeUser("seat-owner");
const licenseManager = await makeUser("seat-license-manager");
const member = await makeUser("seat-member");
const candidate = await makeUser("seat-candidate");
const formerMember = await makeUser("seat-former-member");
const extraMember = await makeUser("seat-extra-member");
const outsider = await makeUser("seat-outsider");

const organization = await db.customerAccount.create({
  data: {
    type: "ORGANIZATION",
    displayName: "Seat Certification Organization",
    ownerId: owner.id,
    billingEmail: owner.email,
    organization: {
      create: {
        legalName: "Seat Certification Organization Legal",
      },
    },
    memberships: {
      create: [
        { userId: licenseManager.id, role: "LICENSE_MANAGER" },
        { userId: member.id, role: "MEMBER" },
        { userId: candidate.id, role: "MEMBER" },
        { userId: formerMember.id, role: "MEMBER" },
        { userId: extraMember.id, role: "MEMBER" },
      ],
    },
  },
});

const otherAccount = await db.customerAccount.create({
  data: {
    type: "INDIVIDUAL",
    displayName: "Seat Other Account",
    ownerId: outsider.id,
    billingEmail: outsider.email,
  },
});

const product = await db.product.create({
  data: {
    slug: `seat-cert-${suffix}`,
    productId: `bke-seat-cert-${suffix}`,
    name: "Seat Certification Product",
    summary: "Certification summary",
    description: "Certification description",
    type: "SOFTWARE",
    publishedAt: new Date(),
    editions: {
      create: {
        slug: "pro",
        name: "Pro",
        maxUsers: 3,
        maxDevicesPerUser: 2,
        purchasePlans: {
          create: {
            type: "MONTHLY",
            currency: "PHP",
            amountMinor: 100000,
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
    number: `ORD-SEAT-${suffix}`,
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
        priceId: `price-seat-${suffix}`,
        policyId: `policy-seat-${suffix}`,
        productName: product.name,
        priceName: "Monthly",
        quantity: 1,
        unitAmountMinor: 100000,
        totalMinor: 100000,
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
    },
  },
  include: { items: true },
});

const license = await db.license.create({
  data: {
    publicId: `LIC-SEAT-${suffix}`,
    keyHash: `seat-key-hash-${suffix}`,
    keyLastFour: "S001",
    accountId: organization.id,
    orderId: order.id,
    orderItemId: order.items[0]!.id,
    productId: product.id,
    editionId: edition.id,
    purchasePlanId: purchasePlan.id,
    status: "ACTIVE",
    maxSeats: 3,
    maxDevicesPerSeat: 2,
    assignments: {
      create: [
        { userId: member.id },
        { userId: formerMember.id },
      ],
    },
  },
});

try {
  await db.membership.delete({
    where: {
      accountId_userId: {
        accountId: organization.id,
        userId: formerMember.id,
      },
    },
  });

  const licenseHandle =
    issueAgentLicenseSeatManagementHandle(
      organization.id,
      license.id,
      license.createdAt,
    );
  const candidateHandle =
    issueAgentLicenseSeatTargetHandle(
      organization.id,
      candidate.id,
    );
  const formerHandle =
    issueAgentLicenseSeatTargetHandle(
      organization.id,
      formerMember.id,
    );

  assert.equal(
    await resolveAgentLicenseSeatManagementHandle({
      accountId: organization.id,
      handle: licenseHandle,
    }),
    license.id,
  );
  assert.equal(
    await resolveAgentLicenseSeatManagementHandle({
      accountId: otherAccount.id,
      handle: licenseHandle,
    }),
    null,
  );
  assert.equal(
    await resolveAgentLicenseSeatTargetHandle({
      accountId: organization.id,
      handle: candidateHandle,
    }),
    candidate.id,
  );
  assert.equal(
    await resolveAgentLicenseSeatTargetHandle({
      accountId: otherAccount.id,
      handle: candidateHandle,
    }),
    null,
  );
  assert.equal(
    await resolveAgentLicenseSeatTargetHandle({
      accountId: organization.id,
      handle: formerHandle,
    }),
    formerMember.id,
  );

  const overview = await getAgentLicenseSeatOverview({
    principalId: licenseManager.id,
    accountId: organization.id,
    licenseId: license.id,
  });
  assert.equal(overview.status, "ready");
  if (overview.status !== "ready") {
    throw new Error("seat overview missing");
  }
  assert.deepEqual(overview.license, {
    productName: product.name,
    editionName: edition.name,
    keyLastFour: "S001",
    maxSeats: 3,
    assignedSeats: 2,
    availableSeats: 1,
  });

  const formerTarget = overview.targets.find(
    (target) => target.email === formerMember.email,
  );
  assert.ok(formerTarget);
  assert.equal(formerTarget.assigned, true);
  assert.equal(formerTarget.eligible, false);
  assert.ok(
    formerTarget.managementHandle.startsWith(
      "bke-license-seat-user-v1_",
    ),
  );

  const denied = await getAgentLicenseSeatOverview({
    principalId: member.id,
    accountId: organization.id,
    licenseId: license.id,
  });
  assert.deepEqual(denied, {
    status: "account_forbidden",
  });

  const resolvedCandidate =
    await resolveAgentLicenseSeatTargetHandle({
      accountId: organization.id,
      handle: candidateHandle,
    });
  assert.equal(resolvedCandidate, candidate.id);

  const assigned = await db.$transaction(
    (tx) =>
      assignLicenseSeat(tx, {
        actorId: licenseManager.id,
        licenseId: license.id,
        targetUserId: resolvedCandidate!,
      }),
    { isolationLevel: "Serializable" },
  );
  assert.equal(assigned.status, "ASSIGNED");
  assert.equal(assigned.value.assignedSeats, 3);
  assert.equal(assigned.value.availableSeats, 0);

  const duplicate = await db.$transaction(
    (tx) =>
      assignLicenseSeat(tx, {
        actorId: licenseManager.id,
        licenseId: license.id,
        targetUserId: resolvedCandidate!,
      }),
    { isolationLevel: "Serializable" },
  );
  assert.equal(duplicate.status, "EXISTING");

  await assert.rejects(
    () =>
      db.$transaction(
        (tx) =>
          assignLicenseSeat(tx, {
            actorId: licenseManager.id,
            licenseId: license.id,
            targetUserId: extraMember.id,
          }),
        { isolationLevel: "Serializable" },
      ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "LICENSE_SEAT_LIMIT",
  );

  const resolvedFormer =
    await resolveAgentLicenseSeatTargetHandle({
      accountId: organization.id,
      handle: formerHandle,
    });
  assert.equal(resolvedFormer, formerMember.id);

  const removed = await db.$transaction(
    (tx) =>
      removeLicenseSeat(tx, {
        actorId: licenseManager.id,
        licenseId: license.id,
        targetUserId: resolvedFormer!,
      }),
    { isolationLevel: "Serializable" },
  );
  assert.equal(removed.status, "REMOVED");
  assert.equal(removed.value.assignedSeats, 2);

  const wire = JSON.stringify(await getAgentLicenseSeatOverview({
    principalId: licenseManager.id,
    accountId: organization.id,
    licenseId: license.id,
  }));
  for (const forbidden of [
    organization.id,
    license.id,
    owner.id,
    member.id,
    candidate.id,
    formerMember.id,
    extraMember.id,
    order.id,
    product.id,
    edition.id,
  ]) {
    assert.equal(wire.includes(forbidden), false);
  }

  console.log(
    "Agent-session license seat management certification: PASS",
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
  await db.order.deleteMany({
    where: { accountId: organization.id },
  });
  await db.customerAccount.deleteMany({
    where: { id: { in: [organization.id, otherAccount.id] } },
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
          candidate.id,
          formerMember.id,
          extraMember.id,
          outsider.id,
        ],
      },
    },
  });
}
