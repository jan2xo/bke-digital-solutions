import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  NativeCustomerRegistrationError,
  verifyNativeCustomerEmail,
} from "@/apps/web/auth/native-customer-registration";
import { emailSchema } from "@/apps/web/http/validation";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  email: emailSchema,
  code: z.string()
    .trim()
    .toUpperCase()
    .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/),
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
    if (
      !(await rateLimit(
        `native-verify-email:${clientIp(request)}:${input.email}`,
        10,
        600,
      )).allowed
    ) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    await verifyNativeCustomerEmail(input.email, input.code);
    return response({ status: "verified" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    if (
      error instanceof NativeCustomerRegistrationError
      && error.code === "INVALID_VERIFICATION_CODE"
    ) {
      return response({ error: error.code }, 400);
    }
    return apiError(error);
  }
}
