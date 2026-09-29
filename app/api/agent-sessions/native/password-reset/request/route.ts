import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID,
  type IdentityPasswordResetRequestCapability,
} from "@bke/identity/contracts/password-reset-request.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { sendPasswordReset } from "@/apps/web/email";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { emailSchema } from "@/apps/web/http/validation";
import { getV2WebApplication } from "@/apps/web/runtime";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  email: emailSchema,
}).strict();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const input = schema.parse(await request.json());
    const accepted = () => response({ status: "accepted" }, 202);

    if (!(await rateLimit(
      `native-password-reset:${clientIp(request)}:${input.email}`,
      5,
      3600,
    )).allowed) {
      return accepted();
    }

    const application = await getV2WebApplication();
    const passwordReset =
      application.get<IdentityPasswordResetRequestCapability>(
        IDENTITY_PASSWORD_RESET_REQUEST_CAPABILITY_ID,
      );
    const result = await passwordReset.request({ email: input.email });

    // Enumeration resistance is part of the native contract. Capability or
    // delivery failure must not tell the caller whether the address exists.
    const delivery =
      result.status === "ACCEPTED" ? result.delivery : null;
    after(async () => {
      if (!delivery) return;
      await sendPasswordReset(
        delivery.recipientEmail,
        delivery.token
      ).catch(() => undefined);
    });

    return accepted();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}
