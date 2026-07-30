import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { CheckoutInput, PaymentEvent, PaymentProvider } from "./types";

const API = "https://api.paymongo.com/v1";
type PayMongoEvent = { data: { id: string; attributes: { type: string; livemode: boolean; created_at: number; data: { id: string; attributes: Record<string, unknown> } } } };

export class PayMongoProvider implements PaymentProvider {
  readonly name = "paymongo";
  async createCheckout(input: CheckoutInput) {
    const response = await fetch(`${API}/checkout_sessions`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${env.PAYMONGO_SECRET_KEY}:`).toString("base64")}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ data: { attributes: {
        billing: { name: input.customer.name, email: input.customer.email },
        line_items: input.items.map((i) => ({ name: i.name, description: i.description, amount: i.amountMinor, currency: input.currency, quantity: i.quantity })),
        payment_method_types: ["card", "gcash", "paymaya"], reference_number: input.reference,
        success_url: `${env.APP_URL}/checkout/success?order=${encodeURIComponent(input.orderId)}`,
        cancel_url: `${env.APP_URL}/checkout/cancel?order=${encodeURIComponent(input.orderId)}`,
        send_email_receipt: false, show_line_items: true,
      } } }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("PAYMENT_PROVIDER_ERROR");
    const body = await response.json() as { data: { id: string; attributes: { checkout_url: string } } };
    return { externalId: body.data.id, checkoutUrl: body.data.attributes.checkout_url };
  }
  async verifyAndParseWebhook(raw: Buffer, headers: Headers): Promise<PaymentEvent> {
    const header = headers.get("paymongo-signature") ?? "";
    const parts = Object.fromEntries(header.split(",").map((part) => part.split("=").map((v) => v.trim())));
    const timestamp = Number(parts.t);
    const signature = env.PAYMONGO_LIVEMODE ? parts.li : parts.te;
    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > 300) throw new Error("INVALID_SIGNATURE");
    const expected = createHmac("sha256", env.PAYMONGO_WEBHOOK_SECRET!).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("INVALID_SIGNATURE");
    const event = JSON.parse(raw.toString("utf8")) as PayMongoEvent;
    const resource = event.data.attributes.data;
    const attrs = resource.attributes;
    const known = ["payment.paid", "payment.failed", "payment.refunded"].includes(event.data.attributes.type);
    return {
      eventId: event.data.id, type: known ? event.data.attributes.type as PaymentEvent["type"] : "unknown",
      externalPaymentId: resource.id, externalCheckoutId: attrs.checkout_session_id as string | undefined,
      reference: (attrs.external_reference_number ?? attrs.reference_number) as string | undefined,
      amountMinor: attrs.amount as number | undefined, currency: attrs.currency as string | undefined,
      livemode: event.data.attributes.livemode, occurredAt: new Date(event.data.attributes.created_at * 1000),
    };
  }
}
