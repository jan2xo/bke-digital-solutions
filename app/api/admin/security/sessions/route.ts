import { NextResponse } from "next/server";
import { z } from "zod";
import { clearSessionCookie, requireRecentAdminSession } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { revokeAdministratorSessions } from "@/apps/web/security/session-administration";

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
    const result = await revokeAdministratorSessions({ request, userId: session.userId, email: session.user.email, currentSessionId: session.id, action: input.action, targetSessionId: input.action === "ONE" ? input.sessionId : undefined });
    if (result.signedOut) await clearSessionCookie();
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
