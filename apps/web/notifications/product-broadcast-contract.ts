export const PRODUCT_BROADCAST_CODES = [
  "BETA_ENDED",
  "TRIAL_ENDED",
  "FREE_SUPPORT_ENDED",
  "LICENSE_RENEWAL_REQUIRED",
] as const;

export const PRODUCT_BROADCAST_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;

export const PRODUCT_BROADCAST_DELIVERY_MODES = [
  "ONCE",
  "EVERY_LAUNCH",
] as const;

export type ProductBroadcastCode = (typeof PRODUCT_BROADCAST_CODES)[number];
export type ProductBroadcastPriority = (typeof PRODUCT_BROADCAST_PRIORITIES)[number];
export type ProductBroadcastDeliveryMode =
  (typeof PRODUCT_BROADCAST_DELIVERY_MODES)[number];

export type ProductBroadcastSourceRow = Readonly<{
  sourceReference: string | null;
  sourceEvent: string;
  priority: string;
  attributes: unknown;
  createdAt: Date;
  expiresAt: Date | null;
}>;

export type ProductBroadcastItem = Readonly<{
  broadcastId: string;
  code: ProductBroadcastCode;
  audience: "ALL_ACTIVE_CLIENTS";
  priority: ProductBroadcastPriority;
  deliveryMode: ProductBroadcastDeliveryMode;
  publishedAt: string;
  startsAt: string;
  endsAt: string | null;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function member<T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

export function projectProductBroadcast(
  row: ProductBroadcastSourceRow,
  requestedVersion: string,
  now = new Date(),
): ProductBroadcastItem | null {
  if (!row.sourceReference || !UUID_PATTERN.test(row.sourceReference)) {
    return null;
  }
  if (!member(PRODUCT_BROADCAST_CODES, row.sourceEvent)) {
    return null;
  }
  if (!member(PRODUCT_BROADCAST_PRIORITIES, row.priority)) {
    return null;
  }
  if (row.expiresAt && row.expiresAt <= now) {
    return null;
  }

  const attributes = record(row.attributes);
  if (!attributes || attributes.productVersion !== requestedVersion) {
    return null;
  }

  const deliveryMode = attributes.deliveryMode;
  if (
    typeof deliveryMode !== "string" ||
    !member(PRODUCT_BROADCAST_DELIVERY_MODES, deliveryMode)
  ) {
    return null;
  }

  const startsAtValue = attributes.startsAt;
  if (typeof startsAtValue !== "string") {
    return null;
  }
  const startsAt = new Date(startsAtValue);
  if (!Number.isFinite(startsAt.getTime()) || startsAt > now) {
    return null;
  }

  return Object.freeze({
    broadcastId: row.sourceReference,
    code: row.sourceEvent,
    audience: "ALL_ACTIVE_CLIENTS",
    priority: row.priority,
    deliveryMode,
    publishedAt: row.createdAt.toISOString(),
    startsAt: startsAt.toISOString(),
    endsAt: row.expiresAt?.toISOString() ?? null,
  });
}
