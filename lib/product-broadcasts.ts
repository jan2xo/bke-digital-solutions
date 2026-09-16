import "server-only";

import { randomUUID } from "node:crypto";
import { gte, lte, valid } from "semver";
import { z } from "zod";
import { db } from "@/lib/db";

export const PRODUCT_BROADCAST_CODES = [
  "BETA_ENDED",
  "TRIAL_ENDED",
  "FREE_SUPPORT_ENDED",
  "LICENSE_RENEWAL_REQUIRED",
] as const;

export const PRODUCT_BROADCAST_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const PRODUCT_BROADCAST_AUDIENCES = ["ALL_ACTIVE_CLIENTS"] as const;
export const PRODUCT_BROADCAST_DELIVERY_MODES = ["ONCE", "EVERY_LAUNCH"] as const;

const BROADCAST_GROUP = "product-broadcasts";
const BROADCAST_KEY_PREFIX = "product-broadcast:";
const productIdSchema = z.string().trim().min(3).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const semverSchema = z.string().trim().max(64).refine((value) => valid(value) !== null, "Use a valid semantic version");

export const productBroadcastPublishInput = z.object({
  productId: productIdSchema,
  code: z.enum(PRODUCT_BROADCAST_CODES),
  audience: z.enum(PRODUCT_BROADCAST_AUDIENCES).default("ALL_ACTIVE_CLIENTS"),
  priority: z.enum(PRODUCT_BROADCAST_PRIORITIES).default("HIGH"),
  deliveryMode: z.enum(PRODUCT_BROADCAST_DELIVERY_MODES).default("ONCE"),
  minimumVersion: semverSchema.nullable().optional(),
  maximumVersion: semverSchema.nullable().optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
}).strict();

export const productBroadcastWithdrawInput = z.object({
  productId: productIdSchema,
  code: z.enum(PRODUCT_BROADCAST_CODES),
}).strict();

const storedBroadcastSchema = z.object({
  schemaVersion: z.literal(1),
  broadcastId: z.string().uuid(),
  productId: productIdSchema,
  code: z.enum(PRODUCT_BROADCAST_CODES),
  audience: z.enum(PRODUCT_BROADCAST_AUDIENCES),
  priority: z.enum(PRODUCT_BROADCAST_PRIORITIES),
  deliveryMode: z.enum(PRODUCT_BROADCAST_DELIVERY_MODES).default("ONCE"),
  active: z.boolean(),
  minimumVersion: semverSchema.nullable(),
  maximumVersion: semverSchema.nullable(),
  publishedAt: z.iso.datetime(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  withdrawnAt: z.iso.datetime().nullable(),
}).strict();

export type ProductBroadcastCode = (typeof PRODUCT_BROADCAST_CODES)[number];
export type ProductBroadcastRecord = z.infer<typeof storedBroadcastSchema>;
export type ProductBroadcastPublishInput = z.infer<typeof productBroadcastPublishInput>;

function storageKey(productId: string, code: ProductBroadcastCode): string {
  return `${BROADCAST_KEY_PREFIX}${productId}:${code}`;
}

function parseStoredBroadcast(value: string): ProductBroadcastRecord | null {
  try {
    const parsed = storedBroadcastSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function assertBroadcastRange(input: ProductBroadcastPublishInput, startsAt: Date): void {
  if (input.minimumVersion && input.maximumVersion && !lte(input.minimumVersion, input.maximumVersion)) {
    throw new Error("INVALID_BROADCAST_VERSION_RANGE");
  }
  if (input.endsAt && new Date(input.endsAt) <= startsAt) {
    throw new Error("INVALID_BROADCAST_DATES");
  }
}

async function requireActiveProduct(productId: string): Promise<void> {
  const product = await db.product.findFirst({
    where: { productId, active: true, deletionRequestedAt: null },
    select: { id: true },
  });
  if (!product) throw new Error("NOT_FOUND");
}

export function isProductBroadcastApplicable(
  broadcast: ProductBroadcastRecord,
  version: string,
  now: Date = new Date(),
): boolean {
  if (!broadcast.active || valid(version) === null) return false;
  const startsAt = new Date(broadcast.startsAt);
  const endsAt = broadcast.endsAt ? new Date(broadcast.endsAt) : null;
  if (startsAt > now || (endsAt !== null && endsAt <= now)) return false;
  if (broadcast.minimumVersion && !gte(version, broadcast.minimumVersion)) return false;
  if (broadcast.maximumVersion && !lte(version, broadcast.maximumVersion)) return false;
  return true;
}

export async function publishProductBroadcast(
  actorId: string,
  rawInput: ProductBroadcastPublishInput,
): Promise<ProductBroadcastRecord> {
  const input = productBroadcastPublishInput.parse(rawInput);
  await requireActiveProduct(input.productId);

  const now = new Date();
  const startsAt = input.startsAt ? new Date(input.startsAt) : now;
  assertBroadcastRange(input, startsAt);

  const record = storedBroadcastSchema.parse({
    schemaVersion: 1,
    broadcastId: randomUUID(),
    productId: input.productId,
    code: input.code,
    audience: input.audience,
    priority: input.priority,
    deliveryMode: input.deliveryMode,
    active: true,
    minimumVersion: input.minimumVersion ?? null,
    maximumVersion: input.maximumVersion ?? null,
    publishedAt: now.toISOString(),
    startsAt: startsAt.toISOString(),
    endsAt: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    withdrawnAt: null,
  });

  await db.$transaction(async (tx) => {
    await tx.siteContent.upsert({
      where: { key: storageKey(record.productId, record.code) },
      create: {
        key: storageKey(record.productId, record.code),
        group: BROADCAST_GROUP,
        value: JSON.stringify(record),
        updatedBy: actorId,
      },
      update: {
        group: BROADCAST_GROUP,
        value: JSON.stringify(record),
        updatedBy: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "PRODUCT_BROADCAST_PUBLISHED",
        targetType: "ProductBroadcast",
        targetId: record.broadcastId,
        metadata: {
          productId: record.productId,
          code: record.code,
          audience: record.audience,
          priority: record.priority,
          deliveryMode: record.deliveryMode,
          minimumVersion: record.minimumVersion,
          maximumVersion: record.maximumVersion,
          startsAt: record.startsAt,
          endsAt: record.endsAt,
        },
      },
    });
  });

  return record;
}

export async function withdrawProductBroadcast(
  actorId: string,
  rawInput: z.infer<typeof productBroadcastWithdrawInput>,
): Promise<ProductBroadcastRecord> {
  const input = productBroadcastWithdrawInput.parse(rawInput);
  const key = storageKey(input.productId, input.code);

  return db.$transaction(async (tx) => {
    const row = await tx.siteContent.findUnique({ where: { key } });
    const current = row ? parseStoredBroadcast(row.value) : null;
    if (!current) throw new Error("NOT_FOUND");

    const withdrawn = storedBroadcastSchema.parse({
      ...current,
      active: false,
      withdrawnAt: new Date().toISOString(),
    });

    await tx.siteContent.update({
      where: { key },
      data: { value: JSON.stringify(withdrawn), updatedBy: actorId },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "PRODUCT_BROADCAST_WITHDRAWN",
        targetType: "ProductBroadcast",
        targetId: withdrawn.broadcastId,
        metadata: { productId: withdrawn.productId, code: withdrawn.code },
      },
    });
    return withdrawn;
  });
}

export async function listProductBroadcasts(productId?: string): Promise<ProductBroadcastRecord[]> {
  const parsedProductId = productId ? productIdSchema.parse(productId) : null;
  const rows = await db.siteContent.findMany({
    where: { group: BROADCAST_GROUP },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });
  return rows
    .map((row) => parseStoredBroadcast(row.value))
    .filter((value): value is ProductBroadcastRecord => value !== null)
    .filter((value) => parsedProductId === null || value.productId === parsedProductId);
}

export async function resolveProductBroadcasts(input: {
  productId: string;
  version: string;
  now?: Date;
}): Promise<ProductBroadcastRecord[]> {
  const productId = productIdSchema.parse(input.productId);
  if (valid(input.version) === null) throw new Error("INVALID_VERSION");
  await requireActiveProduct(productId);
  const now = input.now ?? new Date();
  const broadcasts = await listProductBroadcasts(productId);
  const priorityRank = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 } as const;
  return broadcasts
    .filter((broadcast) => isProductBroadcastApplicable(broadcast, input.version, now))
    .sort((left, right) => {
      const priority = priorityRank[right.priority] - priorityRank[left.priority];
      if (priority !== 0) return priority;
      return right.publishedAt.localeCompare(left.publishedAt);
    });
}
