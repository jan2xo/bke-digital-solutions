import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSessionCookie, requireRecentAdminSession } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { revokeAdministratorSessions } from "@/lib/security/session-administration";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ONE"), sessionId: z.string().min(1) }),
  z.object({ action: z.literal("OTHERS") }),
  z.object({ action: z.literal("ALL"), confirmation: z.literal("REVOKE ALL SESSIONS") }),
]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireRecentAdminSession();
    const limit = await rateLimit(`admin-session-revoke:${session.userId}:${clientIp(request)}`, 10, 900);
    if (!limit.allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const result = await revokeAdministratorSessions({ userId: session.userId, currentSessionId: session.id, action: input.action, targetSessionId: input.action === "ONE" ? input.sessionId : undefined });
    if (result.signedOut) await clearSessionCookie();
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
