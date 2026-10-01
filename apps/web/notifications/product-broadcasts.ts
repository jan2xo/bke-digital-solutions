import "server-only";

import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { persistNotification } from "@/apps/web/notifications/center";
import {
  PRODUCT_BROADCAST_CODES,
  type ProductBroadcastCode,
  type ProductBroadcastDeliveryMode,
  type ProductBroadcastItem,
  type ProductBroadcastPriority,
  projectProductBroadcast,
} from "@/apps/web/notifications/product-broadcast-contract";

const PRODUCT_BROADCAST_PRESENTATIONS: Record<
  ProductBroadcastCode,
  Readonly<{ title: string; body: string }>
> = {
  BETA_ENDED: {
    title: "Beta period ended",
    body: "The free beta period for this product has ended. Commercial licensing now applies to continued use.",
  },
  TRIAL_ENDED: {
    title: "Trial period ended",
    body: "The trial period for this product has ended. Purchase or activate a commercial license to continue using the software.",
  },
  FREE_SUPPORT_ENDED: {
    title: "Free support period ended",
    body: "The complimentary support period for this product has ended. Continued support is available under the applicable commercial support terms.",
  },
  LICENSE_RENEWAL_REQUIRED: {
    title: "License renewal required",
    body: "The current commercial license requires renewal. Renew the license to continue receiving licensed access and services.",
  },
};

type ProductScope = Readonly<{
  internalProductId: string;
  productId: string;
  version: string;
}>;

async function resolveProductScope(
  client: Prisma.TransactionClient | typeof db,
  productId: string,
  version: string,
): Promise<ProductScope | null> {
  const product = await client.product.findFirst({
    where: {
      productId,
      archivedAt: null,
    },
    select: { id: true, productId: true },
  });
  if (!product?.productId) return null;

  const productVersion = await client.productVersion.findFirst({
    where: {
      productId: product.id,
      version,
    },
    select: { id: true, version: true },
  });
  if (!productVersion) return null;

  return Object.freeze({
    internalProductId: product.id,
    productId: product.productId,
    version: productVersion.version,
  });
}

export async function listProductBroadcasts(input: Readonly<{
  productId: string;
  version: string;
  now?: Date;
}>): Promise<Readonly<{
  productId: string;
  version: string;
  broadcasts: readonly ProductBroadcastItem[];
}> | null> {
  const scope = await resolveProductScope(db, input.productId, input.version);
  if (!scope) return null;

  const now = input.now ?? new Date();
  const rows = await db.notificationMessage.findMany({
    where: {
      sourceModule: "notifications",
      sourceEvent: { in: [...PRODUCT_BROADCAST_CODES] },
      audienceKind: "ALL_ACTIVE_CLIENTS",
      productId: scope.internalProductId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const broadcasts = rows
    .map((row) => projectProductBroadcast(row, scope.version, now))
    .filter((item): item is ProductBroadcastItem => item !== null);

  return Object.freeze({
    productId: scope.productId,
    version: scope.version,
    broadcasts: Object.freeze(broadcasts),
  });
}

export async function publishProductBroadcast(input: Readonly<{
  actorId: string;
  operationId: string;
  productId: string;
  version: string;
  code: ProductBroadcastCode;
  priority: ProductBroadcastPriority;
  deliveryMode: ProductBroadcastDeliveryMode;
  startsAt?: Date;
  endsAt?: Date;
}>) {
  const now = new Date();
  const startsAt = input.startsAt ?? now;
  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error("INVALID_NOTIFICATION_WINDOW");
  }
  if (
    input.endsAt &&
    (!Number.isFinite(input.endsAt.getTime()) || input.endsAt <= startsAt)
  ) {
    throw new Error("INVALID_NOTIFICATION_WINDOW");
  }

  return db.$transaction(async (tx) => {
    const scope = await resolveProductScope(
      tx,
      input.productId,
      input.version,
    );
    if (!scope) throw new Error("NOT_FOUND");

    const presentation = PRODUCT_BROADCAST_PRESENTATIONS[input.code];
    const persisted = await persistNotification(tx, {
      source: {
        moduleId: "notifications",
        event: input.code,
        sourceReference: input.operationId,
      },
      audience: { kind: "ALL_ACTIVE_CLIENTS" },
      content: {
        title: presentation.title,
        body: presentation.body,
        category: "CUSTOM",
        data: {
          broadcastId: input.operationId,
          productId: scope.productId,
          version: scope.version,
          deliveryMode: input.deliveryMode,
        },
      },
      context: {
        trigger: "CUSTOM",
        placementHint: "bke-product-broadcast",
        attributes: {
          productVersion: scope.version,
          deliveryMode: input.deliveryMode,
          startsAt: startsAt.toISOString(),
        },
      },
      priority: input.priority,
      idempotencyKey: `product-broadcast:${input.operationId}`,
      productId: scope.internalProductId,
      createdAt: now,
      expiresAt: input.endsAt ?? null,
    });

    if (!("notification" in persisted)) {
      throw new Error("NOTIFICATION_REJECTED");
    }

    if (persisted.status === "CREATED") {
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "PRODUCT_BROADCAST_PUBLISHED",
          targetType: "NotificationMessage",
          targetId: persisted.notification.id,
          metadata: {
            broadcastId: input.operationId,
            productId: scope.productId,
            version: scope.version,
            code: input.code,
            priority: input.priority,
            deliveryMode: input.deliveryMode,
            startsAt: startsAt.toISOString(),
            endsAt: input.endsAt?.toISOString() ?? null,
          },
        },
      });
    }

    return Object.freeze({
      status: persisted.status,
      broadcastId: input.operationId,
      notificationId: persisted.notification.id,
    });
  }, { isolationLevel: "Serializable" });
}

export async function endProductBroadcast(input: Readonly<{
  actorId: string;
  productId: string;
  version: string;
  broadcastId: string;
}>) {
  return db.$transaction(async (tx) => {
    const scope = await resolveProductScope(
      tx,
      input.productId,
      input.version,
    );
    if (!scope) throw new Error("NOT_FOUND");

    const notification = await tx.notificationMessage.findFirst({
      where: {
        sourceModule: "notifications",
        sourceEvent: { in: [...PRODUCT_BROADCAST_CODES] },
        sourceReference: input.broadcastId,
        audienceKind: "ALL_ACTIVE_CLIENTS",
        productId: scope.internalProductId,
      },
    });
    if (!notification) throw new Error("NOT_FOUND");

    const attributes =
      notification.attributes &&
      typeof notification.attributes === "object" &&
      !Array.isArray(notification.attributes)
        ? notification.attributes as Record<string, unknown>
        : null;
    if (attributes?.productVersion !== scope.version) {
      throw new Error("NOT_FOUND");
    }

    const now = new Date();
    if (!notification.expiresAt || notification.expiresAt > now) {
      await tx.notificationMessage.update({
        where: { id: notification.id },
        data: { expiresAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "PRODUCT_BROADCAST_ENDED",
          targetType: "NotificationMessage",
          targetId: notification.id,
          metadata: {
            broadcastId: input.broadcastId,
            productId: scope.productId,
            version: scope.version,
          },
        },
      });
    }

    return Object.freeze({
      status: "ENDED" as const,
      broadcastId: input.broadcastId,
      notificationId: notification.id,
    });
  }, { isolationLevel: "Serializable" });
}
