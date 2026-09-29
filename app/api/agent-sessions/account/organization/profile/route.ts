import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { updateOrganizationProfile } from "@/apps/web/accounts/organization-operations";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z
  .object({
    display_name: z.string().trim().min(2).max(120).optional(),
    legal_name: z.string().trim().min(2).max(180).optional(),
    billing_email: z.string().trim().email().max(320).optional(),
    registration_number: z.string().trim().max(80).nullable().optional(),
    tax_id: z.string().trim().max(80).nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.display_name !== undefined ||
      input.legal_name !== undefined ||
      input.billing_email !== undefined ||
      input.registration_number !== undefined ||
      input.tax_id !== undefined,
    { message: "At least one organization profile field is required." },
  );

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

function protocolApiError(error: unknown) {
  const result = apiError(error);
  result.headers.set("cache-control", "no-store");
  result.headers.set(
    "x-bke-account-session-version",
    AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  );
  return result;
}

export async function PATCH(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const authenticated = await authenticateNativeAgentRequest(request);
    if (authenticated.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:organization-profile:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());
    await updateOrganizationProfile({
      actorId: authenticated.userId,
      accountId: authenticated.accountId,
      displayName: input.display_name,
      legalName: input.legal_name,
      billingEmail: input.billing_email,
      registrationNumber: input.registration_number,
      taxId: input.tax_id,
    });

    return response({ status: "updated" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
