import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { resolvePayMongoConfiguration } from "@/lib/provider-config/service";
import type { ResolvedPayMongoConfiguration } from "@/lib/provider-config/types";
import type { CheckoutInput, PaymentEvent, PaymentProvider, ProviderPayment } from "./types";
import type { RefundInput, RefundResult } from "./types";
import { PaymentLifecycleError } from "./errors";

const API = "https://api.paymongo.com/v1";
type PayMongoResource = { id: string; type?: string; attributes: Record<string, unknown> };
type PayMongoEvent = { data: { id: string; attributes: { type: string; livemode: boolean; created_at: number; data: PayMongoResource } } };

export class PayMongoProvider implements PaymentProvider {
  readonly name = "paymongo";
  constructor(private readonly explicitConfig?: { secretKey?: string; webhookSecret?: string; livemode: boolean }) {}
  private async configuration(): Promise<ResolvedPayMongoConfiguration> {
    if (!this.explicitConfig) return resolvePayMongoConfiguration();
    if (!this.explicitConfig.secretKey || !this.explicitConfig.webhookSecret) throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
    return { source: "environment", secretKey: this.explicitConfig.secretKey, webhookSecret: this.explicitConfig.webhookSecret, livemode: this.explicitConfig.livemode };
  }
  private authorization(config: ResolvedPayMongoConfiguration) {
    if (!config.livemode && !config.secretKey.startsWith("sk_test_")) throw new Error("PAYMENT_PROVIDER_UNSAFE_CONFIGURATION");
    if (config.livemode && !config.secretKey.startsWith("sk_live_")) throw new Error("PAYMENT_PROVIDER_UNSAFE_CONFIGURATION");
    return `Basic ${Buffer.from(`${config.secretKey}:`).toString("base64")}`;
  }
  async createCheckout(input: CheckoutInput) {
    const config = await this.configuration();
    const response = await fetch(`${API}/checkout_sessions`, {
      method: "POST",
      headers: { Authorization: this.authorization(config), "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ data: { attributes: {
        billing: { name: input.customer.name, email: input.customer.email },
        line_items: input.items.map((i) => ({ name: i.name, description: i.description, amount: i.amountMinor, currency: input.currency, quantity: i.quantity })),
        payment_method_types: ["card", "gcash", "paymaya"], reference_number: input.reference,
        success_url: `${env.APP_URL}/checkout/success?order=${encodeURIComponent(input.orderId)}`,
        cancel_url: `${env.APP_URL}/checkout/cancel?order=${encodeURIComponent(input.orderId)}`,
        send_email_receipt: false, show_line_items: true,
      } } }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new PaymentLifecycleError("PAYMENT_PROVIDER_UNAVAILABLE", response.status >= 500 || response.status === 429);
    const body = await response.json() as { data: { id: string; attributes: { checkout_url: string } } };
    return { externalId: body.data.id, checkoutUrl: body.data.attributes.checkout_url };
  }
  async retrievePayment(externalId: string): Promise<ProviderPayment> {
    const config = await this.configuration();
    if (!/^pay_[A-Za-z0-9]+$/.test(externalId)) throw new Error("INVALID_PROVIDER_ID");
    const response = await fetch(`${API}/payments/${externalId}`, {
      headers: { Authorization: this.authorization(config) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new PaymentLifecycleError("PAYMENT_PROVIDER_UNAVAILABLE", response.status >= 500 || response.status === 429);
    const body = await response.json() as { data: { id: string; attributes: { status: string; amount: number; currency: string; livemode: boolean; refunds?: unknown[] } } };
    const attributes = body.data.attributes;
    const status = attributes.refunds?.length ? "refunded" : attributes.status === "paid" ? "paid" : attributes.status === "failed" ? "failed" : "pending";
    return { externalId: body.data.id, status, amountMinor: attributes.amount, currency: attributes.currency, livemode: attributes.livemode };
  }
  async verifyAndParseWebhook(raw: Buffer, headers: Headers): Promise<PaymentEvent> {
    const config = await this.configuration();
    this.authorization(config);
    const header = headers.get("paymongo-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((part) => part.split("=").map((v) => v.trim())));
    const timestamp = Number(parts.t);
    const signature = config.livemode ? parts.li : parts.te;
    if (!timestamp || !signature) throw new PaymentLifecycleError("PAYMENT_SIGNATURE_INVALID");
    if (Math.abs(Date.now() / 1000 - timestamp) > 300) throw new PaymentLifecycleError("PAYMENT_SIGNATURE_STALE");
    const expected = createHmac("sha256", config.webhookSecret).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new PaymentLifecycleError("PAYMENT_SIGNATURE_INVALID");
    const event = JSON.parse(raw.toString("utf8")) as PayMongoEvent;
    const resource = event.data.attributes.data;
    const attrs = resource.attributes;
    const rawType = event.data.attributes.type;
    const normalizedType: PaymentEvent["type"] = rawType === "payment.paid" || rawType === "checkout_session.payment.paid" ? "payment.paid"
      : rawType === "payment.failed" || rawType === "checkout_session.payment.failed" ? "payment.failed"
      : rawType === "payment.refunded" ? "payment.refunded"
      : rawType === "payment.refund.updated" ? "payment.refund.updated" : "unknown";
    const payments = Array.isArray(attrs.payments) ? attrs.payments as PayMongoResource[] : [];
    const nestedPayment = payments[0];
    const paymentAttrs = nestedPayment?.attributes ?? attrs;
    const refundResource = resource.type === "refund";
    const refundStatus = refundResource ? String(attrs.status ?? "pending") : undefined;
    return {
      eventId: event.data.id, rawType, type: normalizedType,
      externalPaymentId: nestedPayment?.id ?? (resource.type === "payment" ? resource.id : attrs.payment_id as string | undefined),
      externalCheckoutId: resource.type === "checkout_session" ? resource.id : attrs.checkout_session_id as string | undefined,
      externalRefundId: refundResource ? resource.id : undefined,
      refundStatus: refundStatus === "succeeded" || refundStatus === "success" ? "succeeded" : refundStatus === "failed" ? "failed" : refundStatus ? "pending" : undefined,
      reference: (attrs.reference_number ?? paymentAttrs.external_reference_number) as string | undefined,
      amountMinor: paymentAttrs.amount as number | undefined, currency: paymentAttrs.currency as string | undefined,
      livemode: event.data.attributes.livemode, occurredAt: new Date(event.data.attributes.created_at * 1000),
    };
  }

  async createRefund(input: RefundInput): Promise<RefundResult> {
    const config = await this.configuration();
    const response = await fetch(`${API}/refunds`, {
      method: "POST",
      headers: { Authorization: this.authorization(config), "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ data: { attributes: { amount: input.amountMinor, payment_id: input.paymentId, reason: input.reason, notes: input.notes?.slice(0, 240) } } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new PaymentLifecycleError(response.status === 409 || response.status === 422 ? "PAYMENT_REFUND_NOT_ALLOWED" : "PAYMENT_PROVIDER_UNAVAILABLE", response.status >= 500 || response.status === 429);
    const body = await response.json() as { data: { id: string; attributes: { status?: string; amount: number; payment_id: string } } };
    const status = body.data.attributes.status;
    return { externalId: body.data.id, status: status === "succeeded" || status === "success" ? "succeeded" : status === "failed" ? "failed" : "pending", amountMinor: body.data.attributes.amount, paymentId: body.data.attributes.payment_id };
  }
}
