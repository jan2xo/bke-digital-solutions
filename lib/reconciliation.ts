import "server-only";
import { db } from "@/lib/db";
import { paymentProvider } from "@/lib/payments";
import type { PaymentProvider } from "@/lib/payments/types";

export type ReconciliationResult = { orderId: string; paymentId: string; matched: boolean; differences: string[] };

export async function reconcilePayment(orderId: string, provider: PaymentProvider = paymentProvider): Promise<ReconciliationResult> {
  if (!provider.retrievePayment) throw new Error("RECONCILIATION_UNSUPPORTED");
  const local = await db.payment.findFirst({ where: { orderId, provider: provider.name }, include: { order: true } });
  if (!local) throw new Error("PAYMENT_NOT_FOUND");
  const remote = await provider.retrievePayment(local.externalId);
  const differences: string[] = [];
  if (remote.externalId !== local.externalId) differences.push("external_id");
  if (remote.amountMinor !== local.amountMinor || remote.amountMinor !== local.order.totalMinor) differences.push("amount");
  if (remote.currency !== local.currency || remote.currency !== local.order.currency) differences.push("currency");
  if (remote.livemode !== (process.env.PAYMONGO_LIVEMODE === "true")) differences.push("mode");
  const expected = local.status === "PAID" ? "paid" : local.status === "FAILED" ? "failed" : local.status === "REFUNDED" ? "refunded" : "pending";
  if (remote.status !== expected) differences.push("status");
  return { orderId, paymentId: local.id, matched: differences.length === 0, differences };
}
