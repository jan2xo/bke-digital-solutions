import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { customerReply } from "@/v2/apps/web/support/capability";

const schema = z.object({ body: z.string().trim().min(1).max(8000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    if (!(await rateLimit(`support-reply:${user.id}:${clientIp(request)}`, 20, 3600)).allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    return NextResponse.json(await customerReply({ userId: user.id, ticketId: (await params).id, body: input.body }), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
