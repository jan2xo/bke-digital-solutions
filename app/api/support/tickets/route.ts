import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError } from "@/lib/http";
import { createSupportTicket, publicTicketSelect } from "@/lib/support";

const schema = z.object({ accountId: z.string().min(1), category: z.enum(["ACCOUNT", "PAYMENT", "REFUND", "INVOICE", "LICENSE", "DEVICE", "DOWNLOAD", "SECURITY", "FEATURE_REQUEST", "OTHER"]), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), subject: z.string().trim().min(3).max(160), body: z.string().trim().min(5).max(8000), orderId: z.string().min(1).nullable().optional(), licenseId: z.string().min(1).nullable().optional() });

export async function GET() {
  try {
    const user = await requireUser();
    const tickets = await db.supportTicket.findMany({ where: { OR: [{ createdById: user.id }, { account: { memberships: { some: { userId: user.id } } } }] }, orderBy: { updatedAt: "desc" }, take: 100, select: publicTicketSelect(false) });
    return NextResponse.json({ tickets }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    if (!(await rateLimit(`support-create:${user.id}:${clientIp(request)}`, 10, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const ticket = await createSupportTicket({ ...input, userId: user.id });
    return NextResponse.json({ ticket }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
