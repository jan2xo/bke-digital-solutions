import "server-only";
import type { Prisma, SupportTicketCategory, SupportTicketPriority, SupportTicketState } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit, redact } from "@/lib/audit";
import { queueCommerceEmail } from "@/lib/email";

type Tx = Prisma.TransactionClient;
const PUBLIC_ID_PREFIX = "BKE-SUP";
const ADMIN_NOTIFY = process.env.SUPPORT_EMAIL ?? "support@example.com";

export function supportPublicId(now = new Date(), random = crypto.randomUUID()) {
  return `${PUBLIC_ID_PREFIX}-${now.getUTCFullYear()}-${random.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function assertActiveCustomer(user: { role: string; suspendedAt: Date | null; lifecycleState: string }) {
  if (user.role === "ADMIN") throw new Error("FORBIDDEN");
  if (user.suspendedAt || user.lifecycleState !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
}

export async function assertAccountAccess(tx: Tx, userId: string, accountId: string) {
  const account = await tx.customerAccount.findFirst({ where: { id: accountId, lifecycleState: "ACTIVE", OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] }, select: { id: true, displayName: true, owner: { select: { id: true, email: true, role: true, suspendedAt: true, lifecycleState: true } } } });
  if (!account) throw new Error("FORBIDDEN");
  assertActiveCustomer(account.owner);
  return account;
}

export async function buildSafeSupportContext(tx: Tx, input: { userId: string; accountId: string; orderId?: string | null; licenseId?: string | null }) {
  const account = await assertAccountAccess(tx, input.userId, input.accountId);
  const context: Record<string, unknown> = { account: { id: account.id, displayName: account.displayName } };
  if (input.orderId) {
    const order = await tx.order.findFirst({ where: { id: input.orderId, accountId: input.accountId }, select: { id: true, number: true, status: true, currency: true, totalMinor: true, createdAt: true, paidAt: true } });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    context.order = order;
  }
  if (input.licenseId) {
    const license = await tx.license.findFirst({ where: { id: input.licenseId, accountId: input.accountId, ...(input.orderId ? { orderId: input.orderId } : {}) }, select: { id: true, publicId: true, status: true, keyLastFour: true, maxSeats: true, maxDevicesPerSeat: true, expiresAt: true, product: { select: { name: true } }, edition: { select: { name: true } } } });
    if (!license) throw new Error("LICENSE_NOT_FOUND");
    context.license = license;
  }
  return redact(context) as Prisma.InputJsonObject;
}

async function event(tx: Tx, ticketId: string, actorId: string | null, eventType: string, metadata: Record<string, unknown> = {}) {
  await tx.supportTicketEvent.create({ data: { ticketId, actorId, eventType, metadata: redact(metadata) as Prisma.InputJsonObject } });
}

export async function createSupportTicket(input: { userId: string; accountId: string; category: SupportTicketCategory; priority?: SupportTicketPriority; subject: string; body: string; orderId?: string | null; licenseId?: string | null }) {
  const created = await db.$transaction(async (tx) => {
    const safeContext = await buildSafeSupportContext(tx, input);
    const securityReport = input.category === "SECURITY";
    const ticket = await tx.supportTicket.create({ data: { publicId: supportPublicId(), createdById: input.userId, accountId: input.accountId, orderId: input.orderId ?? null, licenseId: input.licenseId ?? null, category: input.category, priority: securityReport ? "URGENT" : input.priority ?? "NORMAL", subject: input.subject, safeContext, securityReport, lastCustomerReplyAt: new Date(), messages: { create: { authorId: input.userId, body: input.body, visibility: "PUBLIC" } } } });
    await event(tx, ticket.id, input.userId, securityReport ? "SECURITY_REPORT_CREATED" : "TICKET_CREATED", { category: input.category, priority: ticket.priority, publicId: ticket.publicId });
    await queueCommerceEmail(tx, { type: "SUPPORT_TICKET_OPENED", recipient: ADMIN_NOTIFY, subject: `Support ticket ${ticket.publicId}: ${ticket.subject}`, deduplicationKey: `support-opened:${ticket.id}`, payload: { ticketPublicId: ticket.publicId, category: ticket.category, priority: ticket.priority, securityReport } });
    return ticket;
  });
  await audit({ actorId: input.userId, accountId: input.accountId, action: created.securityReport ? "SUPPORT_SECURITY_REPORT_CREATED" : "SUPPORT_TICKET_CREATED", targetType: "SupportTicket", targetId: created.id, metadata: { publicId: created.publicId, category: created.category, priority: created.priority } });
  return created;
}

export async function customerReply(input: { userId: string; ticketId: string; body: string }) {
  return db.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.findFirst({ where: { id: input.ticketId, OR: [{ createdById: input.userId }, { account: { memberships: { some: { userId: input.userId } } } }] }, select: { id: true, state: true } });
    if (!ticket) throw new Error("NOT_FOUND");
    if (["RESOLVED", "CLOSED"].includes(ticket.state)) throw new Error("INVALID_STATE");
    await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, authorId: input.userId, body: input.body, visibility: "PUBLIC" } });
    await tx.supportTicket.update({ where: { id: ticket.id }, data: { state: "WAITING_ON_SUPPORT", lastCustomerReplyAt: new Date() } });
    await event(tx, ticket.id, input.userId, "CUSTOMER_REPLIED");
    return { ok: true };
  });
}

export async function adminUpdateTicket(input: { adminId: string; ticketId: string; body?: string; internalNote?: string; state?: SupportTicketState; priority?: SupportTicketPriority; assignedToId?: string | null }) {
  const result = await db.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.findUniqueOrThrow({ where: { id: input.ticketId }, select: { id: true, createdBy: { select: { email: true } }, publicId: true, subject: true, accountId: true } });
    if (input.body) await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, authorId: input.adminId, body: input.body, visibility: "PUBLIC" } });
    if (input.internalNote) await tx.supportTicketMessage.create({ data: { ticketId: ticket.id, authorId: input.adminId, body: input.internalNote, visibility: "INTERNAL" } });
    const data: Prisma.SupportTicketUpdateInput = { ...(input.state ? { state: input.state, resolvedAt: input.state === "RESOLVED" ? new Date() : undefined, closedAt: input.state === "CLOSED" ? new Date() : undefined, escalatedAt: input.state === "ESCALATED" ? new Date() : undefined } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.assignedToId !== undefined ? { assignedTo: input.assignedToId ? { connect: { id: input.assignedToId } } : { disconnect: true } } : {}), ...(input.body ? { lastAdminReplyAt: new Date() } : {}) };
    const updated = await tx.supportTicket.update({ where: { id: ticket.id }, data });
    await event(tx, ticket.id, input.adminId, "ADMIN_UPDATED", { state: input.state, priority: input.priority, assigned: input.assignedToId !== undefined });
    if (input.body) await queueCommerceEmail(tx, { type: "SUPPORT_TICKET_REPLY", recipient: ticket.createdBy.email, subject: `Support reply for ${ticket.publicId}`, deduplicationKey: `support-reply:${ticket.id}:${Date.now()}`, payload: { ticketPublicId: ticket.publicId } });
    return updated;
  });
  await audit({ actorId: input.adminId, accountId: result.accountId, action: "SUPPORT_TICKET_ADMIN_UPDATED", targetType: "SupportTicket", targetId: result.id, metadata: { state: input.state, priority: input.priority, assigned: input.assignedToId !== undefined, publicReply: Boolean(input.body), internalNote: Boolean(input.internalNote) } });
  return result;
}

export function publicTicketSelect(includeInternal = false) {
  return { id: true, publicId: true, accountId: true, category: true, state: true, priority: true, subject: true, safeContext: true, securityReport: true, assignedToId: includeInternal, createdAt: true, updatedAt: true, messages: { where: includeInternal ? {} : { visibility: "PUBLIC" as const }, orderBy: { createdAt: "asc" as const }, select: { id: true, authorId: true, body: true, visibility: true, createdAt: true } }, events: includeInternal ? { orderBy: { createdAt: "asc" as const }, select: { id: true, eventType: true, metadata: true, actorId: true, createdAt: true } } : false };
}
