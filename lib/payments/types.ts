export type CheckoutInput = {
  orderId: string; reference: string; amountMinor: number; currency: string;
  customer: { name: string; email: string };
  items: Array<{ name: string; description: string; amountMinor: number; quantity: number }>;
  idempotencyKey: string;
};
export type CheckoutResult = { externalId: string; checkoutUrl: string };
export type PaymentEvent = {
  eventId: string; type: "payment.paid" | "payment.failed" | "payment.refunded" | "unknown";
  externalPaymentId?: string; externalCheckoutId?: string; reference?: string;
  amountMinor?: number; currency?: string; livemode: boolean; occurredAt: Date;
};
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyAndParseWebhook(raw: Buffer, headers: Headers): Promise<PaymentEvent>;
}
