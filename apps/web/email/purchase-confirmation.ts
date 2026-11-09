import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { z } from "zod";

export const PURCHASE_CONFIRMATION_TYPE = "PURCHASE_CONFIRMED" as const;

/** Explicit activation is required even after a certified code-only deployment. */
export function purchaseConfirmationEmailEnabled(): boolean {
  return process.env.PURCHASE_CONFIRMATION_EMAIL_ENABLED === "true";
}

const email = z.email().max(254);
const payloadSchema = z.object({
  orderId: z.string().min(1).max(160),
  orderNumber: z.string().min(1).max(160),
  invoiceId: z.string().regex(/^[\w-]{1,160}$/),
  invoiceNumber: z.string().min(1).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  totalMinor: z.number().int().nonnegative(),
  kind: z.enum(["SELF", "GIFT", "RENEWAL"]),
  items: z.array(z.object({
    productName: z.string().min(1).max(300),
    editionName: z.string().nullable(),
    planName: z.string().nullable(),
    quantity: z.number().int().positive(),
  })).min(1).max(100),
}).strict();

export type PurchaseConfirmationPayload = z.infer<typeof payloadSchema>;
export type PurchaseQueueResult = "DISABLED" | "NOT_ELIGIBLE" | "INVALID_RECIPIENT" | "QUEUED" | "ALREADY_QUEUED";

function safeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function renderPurchaseConfirmationEmail(payload: unknown, applicationUrl: string | undefined): string {
  const record = payloadSchema.parse(payload);
  if (!applicationUrl) throw new Error("PURCHASE_EMAIL_APP_URL_REQUIRED");
  let origin: URL;
  try { origin = new URL(applicationUrl); }
  catch { throw new Error("PURCHASE_EMAIL_APP_URL_INVALID"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (!(origin.protocol === "https:" || (origin.protocol === "http:" && local)) ||
      origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("PURCHASE_EMAIL_APP_URL_INVALID");
  }
  const paid = new Intl.NumberFormat("en-PH", { style: "currency", currency: record.currency }).format(record.totalMinor / 100);
  const items = record.items.map(item => "- " + safeText(item.productName) +
    (item.editionName ? " — " + safeText(item.editionName) : "") +
    (item.planName ? " (" + safeText(item.planName) + ")" : "") +
    " × " + item.quantity);
  const purpose = record.kind === "GIFT" ? "Gift purchase" :
    record.kind === "RENEWAL" ? "Subscription renewal" : "Software purchase";
  const guidance = record.kind === "GIFT"
    ? "Manage and share your gift Claim Code from your authenticated BKE account. No Claim Code is included in this email."
    : record.kind === "RENEWAL"
      ? "Your customer-authorized renewal was confirmed. Manage your account and software in BKE."
      : "Your software access is account-bound. Install BKE and sign in using your authorized account.";
  return [
    "BKE Digital Solutions — Purchase confirmed", "",
    "Order: " + safeText(record.orderNumber),
    "Invoice: " + safeText(record.invoiceNumber),
    "Type: " + purpose,
    "Total paid: " + paid, "",
    "Products:", ...items, "", guidance,
    "View commercial invoice: " + new URL("/dashboard/invoices/" + encodeURIComponent(record.invoiceId), origin),
    "Get BKE: " + new URL("/bke", origin),
    "Manage account: " + new URL("/dashboard", origin), "",
    "This is a commercial purchase confirmation, not a BIR-certified tax invoice.",
  ].join("\n");
}

/** Only the verified PAID settlement transaction may call this, after its fulfillment. */
export async function queueVerifiedPurchaseConfirmation(
  tx: Prisma.TransactionClient,
  input: Readonly<{ orderId: string; fulfillmentMode: "ACCOUNT_ENTITLEMENT" | "CLAIM_CODE"; enabled?: boolean }>,
): Promise<PurchaseQueueResult> {
  if (!(input.enabled ?? purchaseConfirmationEmailEnabled())) return "DISABLED";
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true, number: true, status: true, currency: true, totalMinor: true,
      renewalSubscriptionId: true,
      account: { select: { billingEmail: true } },
      invoice: { select: { id: true, number: true, status: true, currency: true, totalMinor: true } },
      items: { select: { productName: true, editionName: true, planName: true, quantity: true }, orderBy: { id: "asc" } },
    },
  });
  if (!order || order.status !== "PAID" || order.invoice?.status !== "FINAL" ||
      order.invoice.currency !== order.currency || order.invoice.totalMinor !== order.totalMinor ||
      order.items.length === 0) return "NOT_ELIGIBLE";
  const recipient = order.account.billingEmail.trim();
  if (!email.safeParse(recipient).success) return "INVALID_RECIPIENT";
  const payload: PurchaseConfirmationPayload = {
    orderId: order.id, orderNumber: order.number,
    invoiceId: order.invoice.id, invoiceNumber: order.invoice.number,
    currency: order.currency, totalMinor: order.totalMinor,
    kind: input.fulfillmentMode === "CLAIM_CODE" ? "GIFT" :
      order.renewalSubscriptionId ? "RENEWAL" : "SELF",
    items: order.items.map(item => ({
      productName: safeText(item.productName),
      editionName: item.editionName ? safeText(item.editionName) : null,
      planName: item.planName ? safeText(item.planName) : null,
      quantity: item.quantity,
    })),
  };
  if (!payloadSchema.safeParse(payload).success) return "NOT_ELIGIBLE";
  const result = await tx.emailOutbox.createMany({
    data: [{
      type: PURCHASE_CONFIRMATION_TYPE,
      recipient,
      subject: "BKE purchase confirmed · " + safeText(order.number),
      payload: payload as Prisma.InputJsonValue,
      deduplicationKey: "purchase-confirmed:" + order.id,
    }],
    skipDuplicates: true,
  });
  return result.count === 0 ? "ALREADY_QUEUED" : "QUEUED";
}
