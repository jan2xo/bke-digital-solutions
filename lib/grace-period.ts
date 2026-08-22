import { db } from "@/lib/db";

export const GRACE_PRODUCTS = ["airstack", "renderdock"] as const;
export type GraceProduct = (typeof GRACE_PRODUCTS)[number];

const isGraceProduct = (value: string): value is GraceProduct =>
  (GRACE_PRODUCTS as readonly string[]).includes(value);

export function parseGraceProduct(value: string): GraceProduct {
  if (!isGraceProduct(value)) {
    throw new Error(`Unknown grace product: ${value}`);
  }
  return value;
}

export function parseGraceBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Grace value must be exactly true or false.");
}

export async function readGraceState(productKey: GraceProduct): Promise<boolean> {
  try {
    const row = await db.productGraceOverride.findUnique({
      where: { productKey },
      select: { graceEnabled: true },
    });
    return row?.graceEnabled === true;
  } catch {
    return false;
  }
}

export async function readGraceStatuses(): Promise<Record<GraceProduct, boolean>> {
  const rows = await db.productGraceOverride.findMany({
    where: { productKey: { in: [...GRACE_PRODUCTS] } },
    select: { productKey: true, graceEnabled: true },
  });
  const result = { airstack: false, renderdock: false };
  for (const row of rows) {
    if (isGraceProduct(row.productKey)) result[row.productKey] = row.graceEnabled;
  }
  return result;
}

export async function setGraceState(productKey: GraceProduct, graceEnabled: boolean): Promise<boolean> {
  return db.$transaction(async (transaction) => {
    const existing = await transaction.productGraceOverride.findUnique({
      where: { productKey },
      select: { graceEnabled: true },
    });
    const oldValue = existing?.graceEnabled ?? false;
    await transaction.productGraceOverride.upsert({
      where: { productKey },
      update: { graceEnabled },
      create: { productKey, graceEnabled },
    });
    await transaction.auditLog.create({
      data: {
        action: "GRACE_OVERRIDE_SET",
        targetType: "ProductGraceOverride",
        targetId: productKey,
        metadata: {
          product: productKey,
          oldValue,
          newValue: graceEnabled,
          operationSource: "VPS_CLI",
        },
      },
    });
    return oldValue;
  });
}
