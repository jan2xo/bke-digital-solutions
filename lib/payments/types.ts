export type CheckoutInput = {
  orderId: string; reference: string; amountMinor: number; currency: string;
  customer: { name: string; email: string };
  items: Array<{ name: string; description: string; amountMinor: number; quantity: number }>;
  idempotencyKey: string;
};
export type CheckoutResult = { externalId: string; checkoutUrl: string };
export type ProviderPayment = { externalId: string; status: "paid" | "failed" | "refunded" | "pending"; amountMinor: number; currency: string; livemode: boolean };
export type RefundInput = { paymentId: string; amountMinor: number; reason: "requested_by_customer" | "duplicate" | "fraudulent" | "other"; notes?: string; idempotencyKey: string };
export type RefundResult = { externalId: string; status: "pending" | "succeeded" | "failed"; amountMinor: number; paymentId: string };
export type PaymentEvent = {
  eventId: string; rawType?: string; type: "payment.paid" | "payment.failed" | "payment.refunded" | "payment.refund.updated" | "unknown";
  externalPaymentId?: string; externalCheckoutId?: string; reference?: string;
  externalRefundId?: string; refundStatus?: "pending" | "succeeded" | "failed";
  amountMinor?: number; currency?: string; livemode: boolean; occurredAt: Date;
};
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyAndParseWebhook(raw: Buffer, headers: Headers): Promise<PaymentEvent>;
  retrievePayment?(externalId: string): Promise<ProviderPayment>;
  createRefund?(input: RefundInput): Promise<RefundResult>;
}
