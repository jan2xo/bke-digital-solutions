import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  deliverNativeCustomerVerification,
  NativeCustomerRegistrationError,
  registerNativeCustomer,
} from "@/apps/web/auth/native-customer-registration";
import {
  emailSchema,
  passwordSchema,
} from "@/apps/web/http/validation";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2).max(100),
  password: passwordSchema,
  legal_version_ids: z.array(z.string().cuid()).length(2),
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
    const ip = clientIp(request);
    if (
      !(await rateLimit(`native-register:${ip}`, 5, 3600)).allowed
      || !(await rateLimit(
        `native-register:email:${input.email}`,
        5,
        3600,
      )).allowed
    ) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const delivery = await registerNativeCustomer({
      email: input.email,
      name: input.name,
      password: input.password,
      legalVersionIds: input.legal_version_ids,
      request,
    });

    after(async () => {
      await deliverNativeCustomerVerification(delivery)
        .catch(() => undefined);
    });

    return response({
      status: "verification_required",
    }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    if (error instanceof NativeCustomerRegistrationError) {
      if (error.code === "ACCOUNT_EXISTS") {
        return response({ error: error.code }, 409);
      }
    }
    if (
      error instanceof Error
      && error.message === "LEGAL_ACCEPTANCE_REQUIRED"
    ) {
      return response({ error: "LEGAL_ACCEPTANCE_REQUIRED" }, 409);
    }
    if (
      error instanceof Error
      && error.message === "LEGAL_DOCUMENTS_UNAVAILABLE"
    ) {
      return response({ error: "REGISTRATION_UNAVAILABLE" }, 503);
    }
    return apiError(error);
  }
}
