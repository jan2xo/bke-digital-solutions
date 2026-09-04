import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { adminUpdateTicket, publicTicketSelect } from "@/lib/support";

const updateSchema = z.object({ body: z.string().trim().min(1).max(8000).optional(), internalNote: z.string().trim().min(1).max(8000).optional(), state: z.enum(["OPEN", "TRIAGED", "WAITING_ON_CUSTOMER", "WAITING_ON_SUPPORT", "ESCALATED", "RESOLVED", "CLOSED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assignedToId: z.string().min(1).nullable().optional() });

export async function GET() {
  try {
    await requireRecentAdmin();
    const tickets = await db.supportTicket.findMany({ orderBy: [{ securityReport: "desc" }, { priority: "desc" }, { updatedAt: "desc" }], take: 200, select: publicTicketSelect(true) });
    return NextResponse.json({ tickets }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-support:${admin.id}:${clientIp(request)}`, 60, 3600)).allowed) throw new Error("RATE_LIMITED");
    const ticketId = new URL(request.url).searchParams.get("ticketId");
    if (!ticketId) throw new Error("BAD_REQUEST");
    const input = updateSchema.parse(await request.json());
    return NextResponse.json({ ticket: await adminUpdateTicket({ adminId: admin.id, ticketId, ...input }) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
