import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/platform/host/db";

export function isPaymentIntentCheckoutEnabled(providerName: string | undefined, publicKey: string | undefined): boolean {
  return providerName?.trim().toLowerCase() === "paymongo" && Boolean(publicKey?.trim());
}
export function mayResumePaymentIntentOrder(status: BoundPaymentIntentOrder["status"]): boolean {
  return status === "PENDING";
}
export function paymentIntentSourceReference(principalId: string, accountId: string, nonce: string): string {
  return "checkout:pi:" + createHash("sha256").update(JSON.stringify([principalId, accountId, nonce])).digest("hex");
}
export function paymentIntentRequestFingerprint(input: {
  readonly principalId: string; readonly accountId: string; readonly purchasePlanId: string;
  readonly offerIdentifier: string | null; readonly purchaseFor: "SELF" | "GIFT";
}): string {
  return createHash("sha256").update(JSON.stringify([
    input.principalId, input.accountId, input.purchasePlanId, input.offerIdentifier, input.purchaseFor,
  ])).digest("hex");
}
export interface DurablePaymentIntentAttempt {
  readonly sourceReference: string;
  readonly commercialReference: string;
  readonly provider: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly livemode: boolean;
}
/** Read-only evidence that Commerce preparation reached the durable Payments owner. */
export async function findPaymentIntentAttempt(sourceReference: string): Promise<DurablePaymentIntentAttempt | null> {
  const rows = await db.$queryRaw<DurablePaymentIntentAttempt[]>`
    SELECT "sourceReference", "commercialReference", "provider", "amountMinor", "currency", "livemode"
      FROM "PaymentIntentAttempt"
     WHERE "sourceReference" = ${sourceReference}
     LIMIT 2
  `;
  if (rows.length > 1) throw new Error("PAYMENT_INTENT_SOURCE_NOT_UNIQUE");
  return rows[0] ?? null;
}
export function paymentIntentAttemptMatches(
  attempt: DurablePaymentIntentAttempt,
  expected: { readonly sourceReference: string; readonly commercialReference: string; readonly provider: string; readonly livemode: boolean; readonly amountMinor: number; readonly currency: string },
): boolean {
  return attempt.sourceReference === expected.sourceReference &&
    attempt.commercialReference === expected.commercialReference &&
    attempt.provider.trim().toLowerCase() === expected.provider.trim().toLowerCase() &&
    attempt.livemode === expected.livemode &&
    attempt.amountMinor === expected.amountMinor &&
    attempt.currency.trim().toUpperCase() === expected.currency.trim().toUpperCase();
}
export interface BoundPaymentIntentOrder {
  readonly id: string; readonly accountId: string; readonly sourceReference: string;
  readonly status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  readonly currency: string; readonly totalMinor: number; readonly subtotalMinor: number; readonly taxMinor: number;
  readonly fulfillmentMode: "ACCOUNT_ENTITLEMENT" | "CLAIM_CODE";
  readonly renewalSubscriptionId: string | null; readonly fulfillmentSnapshot: unknown;
  readonly items: readonly Record<string, unknown>[];
}
export async function findBoundPaymentIntentOrderById(orderId: string): Promise<BoundPaymentIntentOrder | null> {
  const rows = await db.$queryRaw<BoundPaymentIntentOrder[]>`
    SELECT o."id", o."accountId", o."sourceReference", o."status"::text AS "status", o."currency",
           o."totalMinor", o."subtotalMinor", o."taxMinor", o."fulfillmentMode"::text AS "fulfillmentMode", o."renewalSubscriptionId",
           o."fulfillmentSnapshot",
           COALESCE(jsonb_agg(to_jsonb(i)) FILTER (WHERE i."id" IS NOT NULL), '[]'::jsonb) AS "items"
      FROM "Order" o
      LEFT JOIN "OrderItem" i ON i."orderId" = o."id"
     WHERE o."id" = ${orderId}
     GROUP BY o."id"
     LIMIT 2
  `;
  if (rows.length > 1) throw new Error("ORDER_ID_NOT_UNIQUE");
  return rows[0] ?? null;
}
export function checkoutBinding(order: Pick<BoundPaymentIntentOrder, "fulfillmentSnapshot">): Record<string, unknown> | null {
  const snapshot = order.fulfillmentSnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const binding = (snapshot as Record<string, unknown>).checkoutBinding;
  return binding && typeof binding === "object" && !Array.isArray(binding)
    ? binding as Record<string, unknown>
    : null;
}
export function paymentIntentOrderMatches(
  order: BoundPaymentIntentOrder,
  expected: { readonly principalId: string; readonly accountId: string; readonly sourceReference: string; readonly requestFingerprint: string; readonly purchasePlanId: string; readonly offerIdentifier: string | null; readonly purchaseFor: "SELF" | "GIFT" },
): boolean {
  const binding = checkoutBinding(order);
  if (!binding) return false;
  const savedLines = binding.lines;
  if (!Array.isArray(savedLines) || !Array.isArray(order.items) || savedLines.length !== order.items.length) return false;
  const lineFields = ["productId", "priceId", "policyId", "quantity", "purchasePlanId", "planType"];
  const key = (line: Record<string, unknown>) => JSON.stringify(lineFields.map((field) => line[field] ?? null));
  const sortedSaved = savedLines.filter((line): line is Record<string, unknown> => !!line && typeof line === "object" && !Array.isArray(line)).map(key).sort();
  const sortedActual = order.items.map(key).sort();
  const safeInteger = (value: unknown): number | null =>
    typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  const lineAmountsAreConsistent = order.items.every((line) => {
    const quantity = safeInteger(line.quantity);
    const unitAmountMinor = safeInteger(line.unitAmountMinor);
    const totalMinor = safeInteger(line.totalMinor);
    return quantity !== null && unitAmountMinor !== null && totalMinor !== null &&
      quantity * unitAmountMinor === totalMinor;
  });
  const itemTotal = order.items.reduce((sum, line) => sum + (safeInteger(line.totalMinor) ?? Number.NaN), 0);
  if (!lineAmountsAreConsistent || !Number.isSafeInteger(itemTotal) ||
    !Number.isSafeInteger(order.subtotalMinor) || !Number.isSafeInteger(order.taxMinor) ||
    !Number.isSafeInteger(order.totalMinor) || itemTotal !== order.subtotalMinor ||
    order.subtotalMinor + order.taxMinor !== order.totalMinor) return false;
  return order.accountId === expected.accountId &&
    order.sourceReference === expected.sourceReference &&
    binding.principalId === expected.principalId &&
    binding.accountId === expected.accountId &&
    binding.requestFingerprint === expected.requestFingerprint &&
    binding.sourceReference === expected.sourceReference &&
    binding.nonceHash === expected.sourceReference.slice("checkout:pi:".length) &&
    binding.purchasePlanId === expected.purchasePlanId &&
    binding.offerIdentifier === expected.offerIdentifier &&
    binding.purchaseFor === expected.purchaseFor &&
    binding.currency === order.currency &&
    binding.fulfillmentMode === order.fulfillmentMode &&
    binding.renewalSubscriptionId === order.renewalSubscriptionId &&
    sortedSaved.length === savedLines.length &&
    JSON.stringify(sortedSaved) === JSON.stringify(sortedActual);
}
