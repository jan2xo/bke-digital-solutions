import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { closeCustomer, customerRetentionBlockers, executeFinalPurge, markPurgeEligible, pseudonymizeCustomer, reopenCustomer, requestPrivacyDeletion, setLegalHold } from "@/lib/customer-lifecycle";
import { securityEvent } from "@/v2/apps/web/security/events";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SUSPEND") }), z.object({ action: z.literal("REACTIVATE") }), z.object({ action: z.literal("RESET_DEVICES") }),
  z.object({ action: z.literal("CLOSE"), confirmation: z.literal("CLOSE CUSTOMER ACCOUNT") }),
  z.object({ action: z.literal("REOPEN") }),
  z.object({ action: z.literal("PRIVACY_REVIEW"), retentionExpiresAt: z.string().datetime(), confirmation: z.literal("START PRIVACY REVIEW") }),
  z.object({ action: z.literal("LEGAL_HOLD"), enabled: z.boolean(), reason: z.string().trim().max(240).optional() }),
  z.object({ action: z.literal("PSEUDONYMIZE"), confirmation: z.literal("PSEUDONYMIZE PERSONAL DATA") }),
  z.object({ action: z.literal("MARK_PURGE_ELIGIBLE") }),
  z.object({ action: z.literal("PURGE"), confirmation: z.string().max(100) }),
]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { await requireRecentAdmin(); return NextResponse.json(await customerRetentionBlockers((await params).id), { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-customer-lifecycle:${admin.id}:${clientIp(request)}`, 20, 3600)).allowed) throw new Error("RATE_LIMITED");
    const id = (await params).id;
    const input = schema.parse(await request.json());
    if (input.action === "CLOSE") await closeCustomer({ userId: id, actorId: admin.id });
    else if (input.action === "REOPEN") await reopenCustomer({ userId: id, actorId: admin.id });
    else if (input.action === "PRIVACY_REVIEW") await requestPrivacyDeletion({ userId: id, actorId: admin.id, retentionExpiresAt: new Date(input.retentionExpiresAt) });
    else if (input.action === "LEGAL_HOLD") await setLegalHold({ userId: id, actorId: admin.id, enabled: input.enabled, reason: input.reason });
    else if (input.action === "PSEUDONYMIZE") await pseudonymizeCustomer({ userId: id, actorId: admin.id });
    else if (input.action === "MARK_PURGE_ELIGIBLE") await markPurgeEligible({ userId: id, actorId: admin.id });
    else if (input.action === "PURGE") { await executeFinalPurge({ userId: id, actorId: admin.id, confirmation: input.confirmation }); await securityEvent("CUSTOMER_PURGE_EXECUTED", request, undefined, { action: "PURGE" }); return new NextResponse(null, { status: 204 }); }
    else {
      const customer = await db.user.findUniqueOrThrow({ where: { id }, select: { id: true, role: true, lifecycleState: true, ownedAccounts: { select: { id: true } } } });
      if (customer.role === "ADMIN") throw new Error("FORBIDDEN");
      if (input.action === "RESET_DEVICES") await db.deviceActivation.updateMany({ where: { license: { accountId: { in: customer.ownedAccounts.map((a) => a.id) } }, active: true }, data: { active: false, deactivatedAt: new Date() } });
      else { if ((input.action === "SUSPEND" && customer.lifecycleState !== "ACTIVE") || (input.action === "REACTIVATE" && customer.lifecycleState !== "SUSPENDED")) throw new Error("INVALID_STATE"); await db.$transaction([db.user.update({ where: { id }, data: { suspendedAt: input.action === "SUSPEND" ? new Date() : null, lifecycleState: input.action === "SUSPEND" ? "SUSPENDED" : "ACTIVE" } }), ...(input.action === "SUSPEND" ? [db.session.deleteMany({ where: { userId: id } })] : [])]); }
      await audit({ actorId: admin.id, action: `CUSTOMER_${input.action}`, targetType: "User", targetId: id, metadata: { accountCount: customer.ownedAccounts.length } });
    }
    await securityEvent("CUSTOMER_LIFECYCLE_CHANGED", request, admin.id, { action: input.action });
    return NextResponse.json({ ok: true, report: await customerRetentionBlockers(id) });
  } catch (error) { return apiError(error); }
}

export async function DELETE() { return NextResponse.json({ error: "HARD_DELETE_DISABLED" }, { status: 405 }); }