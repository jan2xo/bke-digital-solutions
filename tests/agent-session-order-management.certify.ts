import assert from "node:assert/strict";
import { db } from "@/platform/host/db";
import {
  issueAgentOrderCancelHandle,
  issueAgentOrderContinueHandle,
  resolveAgentOrderCancelHandle,
  resolveAgentOrderContinueHandle,
} from "@/apps/web/accounts/agent-order-management";
import {
  cancelAgentPendingOrder,
  continueAgentPendingOrder,
} from "@/apps/web/accounts/agent-order-authority";

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

const owner = await makeUser("order-owner");
const billing = await makeUser("order-billing");
const member = await makeUser("order-member");
const outsider = await makeUser("order-outsider");

const organization = await db.customerAccount.create({
  data: {
    type: "ORGANIZATION",
    displayName: "Order Certification Organization",
    ownerId: owner.id,
    billingEmail: owner.email,
    organization: {
      create: {
        legalName: "Order Certification Organization Legal",
      },
    },
    memberships: {
      create: [
        { userId: billing.id, role: "BILLING" },
        { userId: member.id, role: "MEMBER" },
      ],
    },
  },
});

const otherAccount = await db.customerAccount.create({
  data: {
    type: "INDIVIDUAL",
    displayName: "Order Other Account",
    ownerId: outsider.id,
    billingEmail: outsider.email,
  },
});

const product = await db.product.create({
  data: {
    slug: `order-cert-${suffix}`,
    productId: `bke-order-cert-${suffix}`,
    name: "Order Certification Product",
    summary: "Certification summary",
    description: "Certification description",
    type: "SOFTWARE",
    publishedAt: new Date(),
    editions: {
      create: {
        slug: "pro",
        name: "Pro",
        maxUsers: 1,
        maxDevicesPerUser: 1,
        purchasePlans: {
          create: {
            type: "MONTHLY",
            currency: "PHP",
            amountMinor: 125000,
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
const plan = edition.purchasePlans[0]!;

async function createPendingOrder(label: string) {
  return db.order.create({
    data: {
      number: `ORD-${label}-${suffix}`,
      accountId: organization.id,
      status: "PENDING",
      currency: "PHP",
      subtotalMinor: 125000,
      taxMinor: 0,
      totalMinor: 125000,
      billingSnapshot: { certification: true },
      items: {
        create: {
          productId: product.id,
          priceId: plan.id,
          policyId: edition.id,
          productName: product.name,
          priceName: "Monthly",
          quantity: 1,
          unitAmountMinor: 125000,
          totalMinor: 125000,
          billingType: "SUBSCRIPTION",
          policySnapshot: { certification: true },
          editionId: edition.id,
          purchasePlanId: plan.id,
          editionName: edition.name,
          planName: "Monthly",
          planType: "MONTHLY",
          intervalUnit: "MONTH",
          intervalCount: 1,
          renewalBehavior: "CUSTOMER_AUTHORIZED",
        },
      },
    },
  });
}

const order = await createPendingOrder("PRIMARY");
const inactiveAccountOrder = await createPendingOrder("INACTIVE");

try {
  const continueHandle = issueAgentOrderContinueHandle(
    organization.id,
    order.id,
    order.createdAt,
  );
  const cancelHandle = issueAgentOrderCancelHandle(
    organization.id,
    order.id,
    order.createdAt,
  );

  assert.match(
    continueHandle,
    /^bke-order-continue-v1_[0-9a-f]{64}$/,
  );
  assert.match(
    cancelHandle,
    /^bke-order-cancel-v1_[0-9a-f]{64}$/,
  );
  assert.equal(
    continueHandle.includes(order.id),
    false,
  );
  assert.equal(
    cancelHandle.includes(order.id),
    false,
  );

  assert.equal(
    await resolveAgentOrderContinueHandle({
      accountId: organization.id,
      handle: continueHandle,
    }),
    order.id,
  );
  assert.equal(
    await resolveAgentOrderContinueHandle({
      accountId: otherAccount.id,
      handle: continueHandle,
    }),
    null,
  );
  assert.equal(
    await resolveAgentOrderCancelHandle({
      accountId: organization.id,
      handle: cancelHandle,
    }),
    order.id,
  );
  assert.equal(
    await resolveAgentOrderCancelHandle({
      accountId: otherAccount.id,
      handle: cancelHandle,
    }),
    null,
  );

  assert.deepEqual(
    await continueAgentPendingOrder({
      principalId: member.id,
      accountId: organization.id,
      orderId: order.id,
    }),
    { status: "account_forbidden" },
  );
  assert.deepEqual(
    await cancelAgentPendingOrder({
      principalId: member.id,
      accountId: organization.id,
      orderId: order.id,
    }),
    { status: "account_forbidden" },
  );

  const continued = await continueAgentPendingOrder({
    principalId: billing.id,
    accountId: organization.id,
    orderId: order.id,
  });
  assert.equal(continued.status, "continued");
  if (continued.status !== "continued") {
    throw new Error("pending order continuation failed");
  }
  assert.match(
    continued.checkoutUrl,
    /^https:\/\/native-cert\.bke\.test\/checkout\/success\?/,
  );

  const firstAttempts = await db.paymentAttempt.findMany({
    where: { orderId: order.id },
  });
  assert.equal(firstAttempts.length, 1);
  assert.equal(firstAttempts[0]!.status, "PENDING");
  assert.equal(
    firstAttempts[0]!.checkoutUrl,
    continued.checkoutUrl,
  );

  const continuedAgain = await continueAgentPendingOrder({
    principalId: owner.id,
    accountId: organization.id,
    orderId: order.id,
  });
  assert.deepEqual(continuedAgain, continued);
  assert.equal(
    await db.paymentAttempt.count({
      where: { orderId: order.id },
    }),
    1,
  );

  assert.deepEqual(
    await cancelAgentPendingOrder({
      principalId: billing.id,
      accountId: organization.id,
      orderId: order.id,
    }),
    { status: "cancelled" },
  );

  const persistedOrder = await db.order.findUniqueOrThrow({
    where: { id: order.id },
  });
  assert.equal(persistedOrder.status, "CANCELLED");

  const persistedAttempt =
    await db.paymentAttempt.findFirstOrThrow({
      where: { orderId: order.id },
    });
  assert.equal(persistedAttempt.status, "CANCELLED");

  const audit = await db.auditLog.findFirst({
    where: {
      actorId: billing.id,
      accountId: organization.id,
      action: "ORDER_CANCELLED",
      targetType: "Order",
      targetId: order.id,
    },
  });
  assert.ok(audit);

  assert.equal(
    await resolveAgentOrderContinueHandle({
      accountId: organization.id,
      handle: continueHandle,
    }),
    null,
  );
  assert.equal(
    await resolveAgentOrderCancelHandle({
      accountId: organization.id,
      handle: cancelHandle,
    }),
    null,
  );
  assert.deepEqual(
    await cancelAgentPendingOrder({
      principalId: owner.id,
      accountId: organization.id,
      orderId: order.id,
    }),
    { status: "order_not_found" },
  );

  await db.customerAccount.update({
    where: { id: organization.id },
    data: { lifecycleState: "SUSPENDED" },
  });

  assert.deepEqual(
    await continueAgentPendingOrder({
      principalId: owner.id,
      accountId: organization.id,
      orderId: inactiveAccountOrder.id,
    }),
    { status: "account_not_active" },
  );
  assert.deepEqual(
    await cancelAgentPendingOrder({
      principalId: owner.id,
      accountId: organization.id,
      orderId: inactiveAccountOrder.id,
    }),
    { status: "account_not_active" },
  );

  console.log(
    "Agent-session pending order management certification: PASS",
  );
} finally {
  await db.auditLog.deleteMany({
    where: { accountId: organization.id },
  });
  await db.paymentAttempt.deleteMany({
    where: { order: { accountId: organization.id } },
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
          billing.id,
          member.id,
          outsider.id,
        ],
      },
    },
  });
}
