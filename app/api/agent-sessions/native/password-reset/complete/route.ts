import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID,
  type IdentityPasswordResetCompletionCapability,
} from "@bke/identity/contracts/password-reset-completion.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { passwordSchema } from "@/apps/web/http/validation";
import { getV2WebApplication } from "@/apps/web/runtime";
import { securityEvent } from "@/apps/web/security/events";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
}).strict();

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version":
        AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
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
    if (input.token !== input.token.trim()) {
      return response({ error: "INVALID_TOKEN" }, 400);
    }

    if (!(await rateLimit(
      `native-password-reset-complete:${clientIp(request)}`,
      10,
      600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const application = await getV2WebApplication();
    const passwordReset =
      application.get<IdentityPasswordResetCompletionCapability>(
        IDENTITY_PASSWORD_RESET_COMPLETION_CAPABILITY_ID,
      );

    const result = await passwordReset.complete(input);
    if (result.status === "INVALID") {
      return response({ error: result.code }, 400);
    }
    if (result.status === "FAILED") {
      throw new Error(result.code);
    }

    if (result.role === "ADMIN") {
      await securityEvent(
        "PASSWORD_RESET_COMPLETED",
        request,
        result.userId,
      );
    }

    return response({ status: "completed" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}
