import "server-only";

import { createHash } from "node:crypto";
import {
  NOTIFICATIONS_INTENT_CAPABILITY_ID,
  type NotificationsIntentCapability,
  type NotificationsIntentSnapshot,
} from "@bke/notifications/contracts/notification-intent.contract";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { getV2WebApplication } from "@/apps/web/runtime";

export type AccountNotificationProjection = Readonly<{
  id: string;
  source: string;
  event: string;
  title: string;
  body: string;
  category: NotificationsIntentSnapshot["content"]["category"];
  priority: NotificationsIntentSnapshot["priority"];
  createdAt: string;
  expiresAt: string | null;
  data: unknown;
}>;

function notificationId(idempotencyKey: string): string {
  const hash = createHash("sha256")
    .update("bke-account-notification-v1\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");
  return `bke-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function notificationFromIntent(
  capability: NotificationsIntentCapability,
  input: Parameters<NotificationsIntentCapability["create"]>[0] & {
    readonly createdAt: Date;
  },
): AccountNotificationProjection | null {
  const { createdAt, ...intentInput } = input;
  const result = capability.create(intentInput);
  if (result.status !== "NOTIFY") return null;
  return Object.freeze({
    id: notificationId(result.value.idempotencyKey),
    source: result.value.source.moduleId,
    event: result.value.source.event,
    title: result.value.content.title,
    body: result.value.content.body,
    category: result.value.content.category,
    priority: result.value.priority,
    createdAt: createdAt.toISOString(),
    expiresAt: result.value.expiresAt?.toISOString() ?? null,
    data: result.value.content.data,
  });
}

function push(
  items: AccountNotificationProjection[],
  value: AccountNotificationProjection | null,
): void {
  if (value) items.push(value);
}

function daysUntil(now: Date, target: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

function renewalWindow(
  planType: "MONTHLY" | "ANNUAL" | "PERPETUAL",
  now: Date,
  currentPeriodEnd: Date,
): number | null {
  if (planType === "PERPETUAL" || currentPeriodEnd <= now) return null;
  const days = daysUntil(now, currentPeriodEnd);
  const windows = planType === "MONTHLY" ? [1, 7] : [1, 7, 14];
  return windows.find((window) => days <= window) ?? null;
}

export async function readAccountProductNotifications(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    accountId: string;
    productId: string;
    limit: number;
    now?: Date;
  }>,
): Promise<readonly AccountNotificationProjection[]> {
  const now = input.now ?? new Date();
  const application = await getV2WebApplication();
  const capability = application.get<NotificationsIntentCapability>(
    NOTIFICATIONS_INTENT_CAPABILITY_ID,
  );
  const items: AccountNotificationProjection[] = [];

  const payments = await tx.payment.findMany({
    where: {
      order: {
        accountId: input.accountId,
        items: { some: { productId: input.productId } },
      },
      status: { in: ["PAID", "FAILED", "REFUNDED"] },
    },
    include: {
      order: { select: { id: true, number: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(input.limit, 50),
  });

  for (const payment of payments) {
    if (payment.status === "PAID") {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "payments",
          event: "PAYMENT_RECEIVED",
          sourceReference: payment.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "Payment received",
          body: `Payment for order ${payment.order.number} was confirmed.`,
          category: "TRANSACTIONAL",
          data: {
            orderId: payment.order.id,
            orderNumber: payment.order.number,
            paymentId: payment.id,
          },
        },
        context: { trigger: "PAYMENT_SETTLED", placementHint: "product-inbox" },
        priority: "NORMAL",
        idempotencyKey: `payment-received:${payment.id}`,
        createdAt: payment.paidAt ?? payment.updatedAt,
      }));
    } else if (payment.status === "FAILED") {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "payments",
          event: "PAYMENT_FAILED",
          sourceReference: payment.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "Payment failed",
          body: `Payment for order ${payment.order.number} was not completed.`,
          category: "TRANSACTIONAL",
          data: {
            orderId: payment.order.id,
            orderNumber: payment.order.number,
            paymentId: payment.id,
          },
        },
        context: { trigger: "CUSTOM", placementHint: "product-inbox" },
        priority: "HIGH",
        idempotencyKey: `payment-failed:${payment.id}`,
        createdAt: payment.updatedAt,
      }));
    } else {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "payments",
          event: "REFUND_CONFIRMED",
          sourceReference: payment.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "Refund confirmed",
          body: `The refund for order ${payment.order.number} was confirmed.`,
          category: "TRANSACTIONAL",
          data: {
            orderId: payment.order.id,
            orderNumber: payment.order.number,
            paymentId: payment.id,
          },
        },
        context: { trigger: "CUSTOM", placementHint: "product-inbox" },
        priority: "NORMAL",
        idempotencyKey: `refund-confirmed:${payment.id}`,
        createdAt: payment.updatedAt,
      }));
    }
  }

  const invoices = await tx.invoice.findMany({
    where: {
      status: "FINAL",
      order: {
        accountId: input.accountId,
        items: { some: { productId: input.productId } },
      },
    },
    include: { order: { select: { id: true, number: true } } },
    orderBy: { issuedAt: "desc" },
    take: Math.min(input.limit, 50),
  });

  for (const invoice of invoices) {
    push(items, notificationFromIntent(capability, {
      source: {
        moduleId: "commerce",
        event: "INVOICE_READY",
        sourceReference: invoice.id,
      },
      audience: { kind: "ACCOUNT", accountId: input.accountId },
      content: {
        title: "Invoice ready",
        body: `Invoice ${invoice.number} is available in your customer portal.`,
        category: "TRANSACTIONAL",
        data: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          orderId: invoice.order.id,
          orderNumber: invoice.order.number,
        },
      },
      context: { trigger: "PAYMENT_SETTLED", placementHint: "product-inbox" },
      priority: "NORMAL",
      idempotencyKey: `invoice-ready:${invoice.id}`,
      createdAt: invoice.issuedAt ?? invoice.createdAt,
    }));
  }

  const licenses = await tx.license.findMany({
    where: {
      accountId: input.accountId,
      productId: input.productId,
      status: { in: ["ACTIVE", "EXPIRED"] },
    },
    include: {
      order: { select: { id: true, number: true } },
      trialGrant: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(input.limit, 50),
  });

  for (const license of licenses) {
    if (license.status === "ACTIVE") {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "licensing",
          event: "LICENSE_READY",
          sourceReference: license.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "License ready",
          body: `Licensed access for order ${license.order.number} is ready.`,
          category: "LICENSE",
          data: {
            licenseId: license.id,
            orderId: license.order.id,
            orderNumber: license.order.number,
          },
        },
        context: { trigger: "LICENSE_EVENT", placementHint: "product-inbox" },
        priority: "NORMAL",
        idempotencyKey: `license-ready:${license.id}`,
        createdAt: license.createdAt,
      }));
    } else if (!license.trialGrant) {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "licensing",
          event: "LICENSE_EXPIRED",
          sourceReference: license.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "License expired",
          body: "This license has expired. Review your current access in the customer portal.",
          category: "LICENSE",
          data: { licenseId: license.id },
        },
        context: { trigger: "LICENSE_EVENT", placementHint: "product-inbox" },
        priority: "HIGH",
        idempotencyKey: `license-expired:${license.id}:${license.expiresAt?.toISOString() ?? "unknown"}`,
        createdAt: license.expiresAt ?? license.createdAt,
      }));
    }
  }

  const subscriptions = await tx.subscription.findMany({
    where: {
      accountId: input.accountId,
      productId: input.productId,
      status: { in: ["ACTIVE", "EXPIRED"] },
    },
    include: {
      purchasePlan: { select: { type: true, renewalBehavior: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: Math.min(input.limit, 50),
  });

  for (const subscription of subscriptions) {
    if (
      subscription.status === "ACTIVE" &&
      subscription.purchasePlan?.renewalBehavior === "CUSTOMER_AUTHORIZED"
    ) {
      const window = renewalWindow(
        subscription.purchasePlan.type,
        now,
        subscription.currentPeriodEnd,
      );
      if (window !== null) {
        push(items, notificationFromIntent(capability, {
          source: {
            moduleId: "commerce",
            event: "RENEWAL_APPROACHING",
            sourceReference: subscription.id,
          },
          audience: { kind: "ACCOUNT", accountId: input.accountId },
          content: {
            title: "Renewal approaching",
            body: `Your subscription period ends in about ${window} day${window === 1 ? "" : "s"}. Renew from your customer portal when ready.`,
            category: "TRANSACTIONAL",
            data: {
              subscriptionId: subscription.id,
              windowDays: window,
              currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            },
          },
          context: { trigger: "CUSTOM", placementHint: "product-inbox" },
          priority: window === 1 ? "HIGH" : "NORMAL",
          idempotencyKey: `renewal-approaching:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}:${window}`,
          createdAt: now,
          expiresAt: subscription.currentPeriodEnd,
        }));
      }
    }

    if (subscription.status === "EXPIRED") {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "commerce",
          event: "SUBSCRIPTION_EXPIRED",
          sourceReference: subscription.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "Subscription expired",
          body: "Your subscription period has expired. Current access is governed by your entitlement status.",
          category: "TRANSACTIONAL",
          data: {
            subscriptionId: subscription.id,
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
          },
        },
        context: { trigger: "CUSTOM", placementHint: "product-inbox" },
        priority: "HIGH",
        idempotencyKey: `subscription-expired:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}`,
        createdAt: subscription.currentPeriodEnd,
      }));
    }
  }

  const trials = await tx.trialGrant.findMany({
    where: {
      accountId: input.accountId,
      productId: input.productId,
      revokedAt: null,
    },
    orderBy: { trialEndsAt: "desc" },
    take: Math.min(input.limit, 50),
  });

  for (const trial of trials) {
    if (trial.trialEndsAt > now && trial.trialEndsAt <= new Date(now.getTime() + 86_400_000)) {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "trials",
          event: "TRIAL_ENDING",
          sourceReference: trial.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "Trial ending soon",
          body: "Your product trial is approaching its end. Review purchase options in your customer portal.",
          category: "LICENSE",
          data: { trialId: trial.id, trialEndsAt: trial.trialEndsAt.toISOString() },
        },
        context: { trigger: "LICENSE_EVENT", placementHint: "product-inbox" },
        priority: "NORMAL",
        idempotencyKey: `trial-ending:${trial.id}:${trial.trialEndsAt.toISOString()}`,
        createdAt: now,
        expiresAt: trial.trialEndsAt,
      }));
    } else if (trial.trialEndsAt <= now) {
      push(items, notificationFromIntent(capability, {
        source: {
          moduleId: "trials",
          event: "TRIAL_EXPIRED",
          sourceReference: trial.id,
        },
        audience: { kind: "ACCOUNT", accountId: input.accountId },
        content: {
          title: "Trial ended",
          body: "Your product trial has ended. Review your current entitlement or available purchase options.",
          category: "LICENSE",
          data: { trialId: trial.id, trialEndsAt: trial.trialEndsAt.toISOString() },
        },
        context: { trigger: "LICENSE_EVENT", placementHint: "product-inbox" },
        priority: "HIGH",
        idempotencyKey: `trial-expired:${trial.id}:${trial.trialEndsAt.toISOString()}`,
        createdAt: trial.trialEndsAt,
      }));
    }
  }

  return Object.freeze(
    items
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit),
  );
}
