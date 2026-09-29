import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  deliverNativeCustomerVerification,
  resendNativeCustomerVerification,
} from "@/apps/web/auth/native-customer-registration";
import { emailSchema } from "@/apps/web/http/validation";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  email: emailSchema,
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
    const accepted = () => response({ status: "accepted" }, 202);

    if (
      !(await rateLimit(
        `native-verification-resend:${clientIp(request)}:${input.email}`,
        3,
        3600,
      )).allowed
    ) {
      return accepted();
    }

    after(async () => {
      const delivery = await resendNativeCustomerVerification(input.email)
        .catch(() => null);
      if (!delivery) return;
      await deliverNativeCustomerVerification(delivery)
        .catch(() => undefined);
    });

    return accepted();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}
