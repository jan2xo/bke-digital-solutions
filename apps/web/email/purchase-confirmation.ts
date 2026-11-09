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
  subtotalMinor: z.number().int().nonnegative().optional(),
  taxMinor: z.number().int().nonnegative().optional(),
  paidAt: z.iso.datetime({ offset: true }).optional(),
  kind: z.enum(["SELF", "GIFT", "RENEWAL"]),
  items: z.array(z.object({
    productName: z.string().min(1).max(300),
    editionName: z.string().nullable(),
    planName: z.string().nullable(),
    quantity: z.number().int().positive(),
    amountMinor: z.number().int().nonnegative().optional(),
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

/** Email-client-safe, table-based receipt layout. No external fonts/images or user-controlled HTML. */
export function renderPurchaseConfirmationEmailHtml(payload: unknown, applicationUrl: string | undefined): string {
  const record = payloadSchema.parse(payload);
  // Reuse the plain-text render's strict HTTPS application-origin validation.
  renderPurchaseConfirmationEmail(record, applicationUrl);
  const origin = new URL(applicationUrl!);
  const escapeHtml = (value: string): string => safeText(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const money = (minor: number): string => new Intl.NumberFormat("en-PH", {
    style: "currency", currency: record.currency,
  }).format(minor / 100);
  const invoiceLink = escapeHtml(new URL(
    "/dashboard/invoices/" + encodeURIComponent(record.invoiceId), origin,
  ).toString());
  const accountLink = escapeHtml(new URL("/dashboard", origin).toString());
  const getBkeLink = escapeHtml(new URL("/bke", origin).toString());
  const type = record.kind === "GIFT" ? "Gift purchase" :
    record.kind === "RENEWAL" ? "Subscription renewal" : "Software purchase";
  const intro = record.kind === "RENEWAL"
    ? "Your customer-authorized subscription renewal is confirmed."
    : record.kind === "GIFT"
      ? "Your gift purchase is confirmed. The Claim Code is available only inside your authenticated BKE account."
      : "Your purchase is confirmed. Your software access is linked to your authorized BKE account.";
  const paidAt = record.paidAt ? new Intl.DateTimeFormat("en-PH", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Manila",
  }).format(new Date(record.paidAt)) : null;
  const productRows = record.items.map((item) => {
    const title = escapeHtml(item.productName);
    const details = [item.editionName, item.planName].filter((value): value is string => Boolean(value))
      .map(escapeHtml).join(" · ");
    return '<tr><td style="padding:17px 0;border-bottom:1px solid #e9e9e9;vertical-align:top;">' +
      '<div style="font-size:16px;font-weight:700;color:#171717;">' + title + '</div>' +
      (details ? '<div style="padding-top:5px;font-size:13px;color:#686868;">' + details + '</div>' : '') +
      '<div style="padding-top:4px;font-size:12px;color:#777777;">Quantity: ' + item.quantity + '</div></td>' +
      '<td align="right" style="padding:17px 0;border-bottom:1px solid #e9e9e9;white-space:nowrap;vertical-align:top;font-size:15px;font-weight:700;color:#222222;">' +
      (item.amountMinor === undefined ? 'See invoice' : escapeHtml(money(item.amountMinor))) +
      '</td></tr>';
  }).join("");
  const hasConsistentBreakdown = record.subtotalMinor !== undefined && record.taxMinor !== undefined &&
    record.subtotalMinor + record.taxMinor === record.totalMinor;
  const totals = hasConsistentBreakdown
    ? '<tr><td style="padding:6px 0;color:#707070;">Subtotal</td><td align="right">' + escapeHtml(money(record.subtotalMinor!)) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#707070;">Tax (as invoiced)</td><td align="right">' + escapeHtml(money(record.taxMinor!)) + '</td></tr>'
    : "";
  const guidance = record.kind === "GIFT"
    ? "Manage and share your gift Claim Code only from the authenticated BKE dashboard. No code is included in this message."
    : record.kind === "RENEWAL"
      ? "This renewal was customer-authorized. Future renewal payments are not automatic."
      : "Install BKE, then sign in with your authorized account to manage your software.";
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>BKE Digital Solutions — Order confirmation</title></head>',
    '<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#171717;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:32px 12px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-collapse:collapse;">',
    '<tr><td style="padding:0 0 18px 0;"><span style="display:inline-block;padding:11px 13px;border-radius:10px;background:#111827;color:#facc15;font-size:18px;font-weight:800;letter-spacing:1px;">BKE</span>',
    '<span style="padding-left:12px;color:#161616;font-size:17px;font-weight:700;">Digital Solutions</span></td></tr>',
    '<tr><td style="background:#ffffff;border-radius:16px;padding:32px 30px;border:1px solid #e5e7eb;">',
    '<p style="margin:0 0 8px 0;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#6b7280;">Payment confirmed</p>',
    '<h1 style="margin:0 0 16px 0;font-size:28px;line-height:1.25;font-weight:800;color:#111827;">Order details</h1>',
    '<p style="margin:0 0 24px 0;color:#4b5563;font-size:15px;line-height:1.6;">' + escapeHtml(intro) + '</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;line-height:1.8;">',
    '<tr><td style="color:#737373;">Order number</td><td align="right" style="font-weight:700;color:#111827;">' + escapeHtml(record.orderNumber) + '</td></tr>',
    '<tr><td style="color:#737373;">Invoice number</td><td align="right" style="font-weight:700;color:#111827;">' + escapeHtml(record.invoiceNumber) + '</td></tr>',
    (paidAt ? '<tr><td style="color:#737373;">Paid on</td><td align="right" style="color:#111827;">' + escapeHtml(paidAt) + '</td></tr>' : ''),
    '<tr><td style="color:#737373;">Type</td><td align="right" style="color:#111827;">' + escapeHtml(type) + '</td></tr>',
    '</table><div style="margin:23px 0 8px;border-top:1px solid #e5e7eb;"></div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">', productRows, '</table>',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:22px;font-size:14px;line-height:1.6;">',
    totals,
    '<tr><td style="padding:16px 0 4px;border-top:1px solid #e5e7eb;font-size:18px;font-weight:800;color:#111827;">TOTAL PAID</td>',
    '<td align="right" style="padding:16px 0 4px;border-top:1px solid #e5e7eb;font-size:23px;font-weight:800;color:#111827;">' + escapeHtml(money(record.totalMinor)) + '</td></tr>',
    '</table><div style="padding:22px 0 8px;">',
    '<a href="' + invoiceLink + '" style="display:inline-block;padding:13px 23px;border-radius:9px;text-decoration:none;background:#111827;color:#facc15;font-size:14px;font-weight:700;">View commercial invoice</a>',
    '</div><p style="margin:12px 0 0;color:#4b5563;font-size:13px;line-height:1.6;">' + escapeHtml(guidance) + '</p>',
    '<p style="margin:18px 0 0;font-size:13px;line-height:1.6;"><a href="' + getBkeLink + '" style="color:#1d4ed8;">Get BKE</a>',
    ' &nbsp;·&nbsp; <a href="' + accountLink + '" style="color:#1d4ed8;">Manage account</a></p>',
    '</td></tr><tr><td style="padding:22px 12px 0;color:#737373;text-align:center;font-size:12px;line-height:1.6;">',
    'BKE Digital Solutions · This is a commercial purchase confirmation, not a BIR-certified tax invoice.',
    '</td></tr></table></td></tr></table></body></html>',
  ].join("");
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
      id: true, number: true, status: true, currency: true, totalMinor: true, paidAt: true,
      renewalSubscriptionId: true,
      account: { select: { billingEmail: true } },
      invoice: { select: { id: true, number: true, status: true, currency: true, subtotalMinor: true, taxMinor: true, totalMinor: true } },
      items: { select: { productName: true, editionName: true, planName: true, quantity: true, totalMinor: true }, orderBy: { id: "asc" } },
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
    subtotalMinor: order.invoice.subtotalMinor, taxMinor: order.invoice.taxMinor,
    ...(order.paidAt ? { paidAt: order.paidAt.toISOString() } : {}),
    kind: input.fulfillmentMode === "CLAIM_CODE" ? "GIFT" :
      order.renewalSubscriptionId ? "RENEWAL" : "SELF",
    items: order.items.map(item => ({
      productName: safeText(item.productName),
      editionName: item.editionName ? safeText(item.editionName) : null,
      planName: item.planName ? safeText(item.planName) : null,
      quantity: item.quantity,
      amountMinor: item.totalMinor,
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
