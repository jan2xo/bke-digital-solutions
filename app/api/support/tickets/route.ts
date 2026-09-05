import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { createSupportTicket, listCustomerTickets } from "@/v2/apps/web/support/capability";

const schema = z.object({ accountId: z.string().min(1), category: z.enum(["ACCOUNT", "PAYMENT", "REFUND", "INVOICE", "LICENSE", "DEVICE", "DOWNLOAD", "SECURITY", "FEATURE_REQUEST", "OTHER"]), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), subject: z.string().trim().min(3).max(160), body: z.string().trim().min(5).max(8000), orderId: z.string().min(1).nullable().optional(), licenseId: z.string().min(1).nullable().optional() });

export async function GET() {
  try {
    const user = await requireUser();
    const tickets = await listCustomerTickets(user.id, 100);
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
