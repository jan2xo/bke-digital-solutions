/**
 * A separately signed PayMongo payment.paid notification may arrive alongside
 * checkout_session.payment.paid for the same settled payment. It does not carry
 * checkout identity, so it MUST NEVER create a new settlement/entitlement.
 *
 * A verified already-settled checkout fact is the only authority for treating
 * such a notification as an acknowledged companion instead of an unresolved
 * event. Unknown, mismatched, or out-of-order payment events remain fail-closed.
 */
export type CompanionPaidEvent = Readonly<{
  type: string;
  rawType?: string;
  externalPaymentId?: string;
  externalCheckoutId?: string;
  reference?: string;
  amountMinor?: number;
  currency?: string;
  livemode: boolean;
}>;

export type ProvenSettledPayment = Readonly<{
  paymentId: string;
  orderId: string;
  externalPaymentId: string;
  amountMinor: number;
  currency: string;
  livemode: boolean;
}>;

export function matchesProvenSettledCompanion(
  event: CompanionPaidEvent,
  settlement: ProvenSettledPayment | null,
): settlement is ProvenSettledPayment {
  if (
    event.type !== "payment.paid" ||
    event.rawType !== "payment.paid" ||
    event.externalCheckoutId ||
    event.reference ||
    !event.externalPaymentId ||
    !Number.isSafeInteger(event.amountMinor) ||
    (event.amountMinor ?? 0) <= 0 ||
    !event.currency ||
    !settlement
  ) return false;

  return settlement.externalPaymentId === event.externalPaymentId
    && settlement.amountMinor === event.amountMinor
    && settlement.currency.toUpperCase() === event.currency.toUpperCase()
    && settlement.livemode === event.livemode
    && Boolean(settlement.paymentId && settlement.orderId);
}
