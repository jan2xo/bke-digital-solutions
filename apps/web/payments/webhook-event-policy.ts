import type { PaymentsVerifiedProviderEventSnapshot } from "@bke/payments/contracts/provider-event-ingestion.contract";

/** Only these provider events can change financial state; intent lifecycle and unknown events are acknowledgements only. */
export function ignoredNonFinancialPaymentEventCode(
  type: PaymentsVerifiedProviderEventSnapshot["type"],
): string | null {
  switch (type) {
    case "payment.paid":
    case "payment.failed":
    case "payment.refunded":
    case "payment.refund.updated":
      return null;
    case "unknown":
      return "PAYMENT_EVENT_UNSUPPORTED";
    case "payment_intent.succeeded":
    case "payment_intent.awaiting_payment_method":
    case "qrph.expired":
      return "PAYMENT_INTENT_LIFECYCLE_IGNORED";
    default: {
      const impossible: never = type;
      return impossible;
    }
  }
}
