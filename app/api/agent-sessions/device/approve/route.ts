import { NextResponse } from "next/server";
import { z } from "zod";
import { approveAgentDeviceAuthorization } from "@/apps/web/agent-sessions/device-authorization";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { db } from "@/platform/host/db";

const schema = z.object({
  userCode: z.string().regex(/^BKE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
  customerAccountId: z.string().min(1).max(256),
}).strict();

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.V3_AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    if (!principal.emailVerified) {
      return NextResponse.json({ error: "EMAIL_NOT_VERIFIED" }, { status: 403 });
    }

    const input = schema.parse(await request.json());
    if (
      !(await rateLimit(
        `agent-session:approve:${principal.id}:${clientIp(request)}`,
        30,
        3600,
      )).allowed
    ) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const result = await db.$transaction(
      (tx) => approveAgentDeviceAuthorization(tx, {
        userCode: input.userCode,
        principalId: principal.id,
        accountId: input.customerAccountId,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );

    if (result.status === "NOT_FOUND") {
      return NextResponse.json({ error: "DEVICE_AUTHORIZATION_NOT_FOUND" }, { status: 404 });
    }
    if (result.status === "EXPIRED") {
      return NextResponse.json({ error: "DEVICE_AUTHORIZATION_EXPIRED" }, { status: 410 });
    }
    if (result.status !== "APPROVED") {
      return NextResponse.json(
        {
          error: result.status === "ALREADY_APPROVED"
            ? "DEVICE_AUTHORIZATION_ALREADY_APPROVED"
            : `DEVICE_AUTHORIZATION_${result.status}`,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      status: "APPROVED",
      deviceId: result.deviceId,
      account: {
        id: result.account.id,
        type: result.account.type,
        displayName: result.account.displayName,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
