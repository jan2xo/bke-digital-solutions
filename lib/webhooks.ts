import "server-only";
import { db } from "@/lib/db";
import { paymentProvider } from "@/lib/payments";
import { issueEntitlements } from "@/lib/licensing";
import { sha256 } from "@/lib/security/crypto";
import { dispatchEmailOutbox, queueCommerceEmail } from "@/lib/email";

export async function processPaymentWebhook(raw: Buffer, headers: Headers) {
  const event = await paymentProvider.verifyAndParseWebhook(raw, headers);
  if (event.livemode !== (process.env.PAYMONGO_LIVEMODE === "true")) throw new Error("MODE_MISMATCH");
  const inserted = await db.webhookEvent.createMany({ data: [{ provider: paymentProvider.name, externalEventId: event.eventId, eventType: event.type, livemode: event.livemode, payloadHash: sha256(raw), status: "RECEIVED" }], skipDuplicates: true });
  if (inserted.count === 0) return { duplicate: true };
  if (event.type === "unknown") {
    await db.webhookEvent.update({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, data: { status: "IGNORED", processedAt: new Date() } });
    return { ignored: true };
  }
  try {
    await db.$transaction(async (tx) => {
      const attempt = event.externalCheckoutId ? await tx.paymentAttempt.findUnique({ where: { externalCheckoutId: event.externalCheckoutId }, include: { order: true } }) : null;
      const order = attempt?.order ?? (event.reference ? await tx.order.findUnique({ where: { number: event.reference } }) : null);
      if (!order || event.amountMinor !== order.totalMinor || event.currency !== order.currency) throw new Error("PAYMENT_MISMATCH");
      if (event.type === "payment.paid") {
        if (order.status !== "PAID") {
          await tx.payment.upsert({ where: { provider_externalId: { provider: paymentProvider.name, externalId: event.externalPaymentId! } }, create: { orderId: order.id, provider: paymentProvider.name, externalId: event.externalPaymentId!, status: "PAID", amountMinor: event.amountMinor!, currency: event.currency!, paidAt: event.occurredAt }, update: { status: "PAID", paidAt: event.occurredAt } });
          await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: event.occurredAt } });
          const invoice=await tx.invoice.update({ where: { orderId: order.id }, data: { status: "FINAL", issuedAt: event.occurredAt } });
          await issueEntitlements(tx, order.id);
          const account=await tx.customerAccount.findUniqueOrThrow({where:{id:order.accountId}});
          await queueCommerceEmail(tx,{type:"PAYMENT_RECEIPT",recipient:account.billingEmail,subject:"BKE Digital Solutions payment receipt",payload:{orderNumber:order.number}});
          await queueCommerceEmail(tx,{type:"INVOICE_ISSUED",recipient:account.billingEmail,subject:"Your BKE Digital Solutions invoice",payload:{orderNumber:order.number,invoiceNumber:invoice.number}});
          await queueCommerceEmail(tx,{type:"LICENSE_ISSUED",recipient:account.billingEmail,subject:"Your BKE Digital Solutions license is ready",payload:{orderNumber:order.number}});
        }
      }
      if (event.type === "payment.failed") {
        if (event.externalPaymentId) await tx.payment.upsert({ where: { provider_externalId: { provider: paymentProvider.name, externalId: event.externalPaymentId } }, create: { orderId: order.id, provider: paymentProvider.name, externalId: event.externalPaymentId, status: "FAILED", amountMinor: event.amountMinor!, currency: event.currency! }, update: { status: "FAILED" } });
        if (attempt) await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED" } });
        const account=await tx.customerAccount.findUniqueOrThrow({where:{id:order.accountId}});await queueCommerceEmail(tx,{type:"PAYMENT_FAILED",recipient:account.billingEmail,subject:"BKE Digital Solutions payment failed",payload:{orderNumber:order.number}});
      }
      if (event.type === "payment.refunded" && order.status === "PAID") {
        if (event.externalPaymentId) await tx.payment.updateMany({ where: { provider: paymentProvider.name, externalId: event.externalPaymentId }, data: { status: "REFUNDED" } });
        await tx.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
        await tx.invoice.update({ where: { orderId: order.id }, data: { status: "VOID" } });
        await tx.license.updateMany({ where: { orderId: order.id }, data: { status: "REVOKED" } });
        await tx.subscription.updateMany({ where: { orderId: order.id }, data: { status: "CANCELLED" } });
        const account=await tx.customerAccount.findUniqueOrThrow({where:{id:order.accountId}});await queueCommerceEmail(tx,{type:"REFUND_CONFIRMED",recipient:account.billingEmail,subject:"BKE Digital Solutions refund confirmed",payload:{orderNumber:order.number}});
      }
      await tx.webhookEvent.update({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, data: { status: "PROCESSED", processedAt: new Date() } });
    }, { isolationLevel: "Serializable" });
    await dispatchEmailOutbox().catch(()=>undefined);
    return { processed: true };
  } catch (error) {
    await db.webhookEvent.update({ where: { provider_externalEventId: { provider: paymentProvider.name, externalEventId: event.eventId } }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN" } });
    throw error;
  }
}
