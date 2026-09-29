import {
  LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  type LegalReacceptanceStatusCapability,
} from "@bke/legal/contracts/reacceptance-status.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { createOrganizationAccount } from "@/apps/web/accounts/organization-operations";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z
  .object({
    display_name: z.string().trim().min(2).max(120),
    legal_name: z.string().trim().min(2).max(180),
    billing_email: z.string().trim().email().max(320),
    registration_number: z.string().trim().max(80).optional(),
    tax_id: z.string().trim().max(80).optional(),
  })
  .strict();

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

export async function POST(request: Request) {
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
      `agent-session:organization-create:${authenticated.userId}:${clientIp(request)}`,
      10,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const principal = await db.user.findUnique({
      where: { id: authenticated.userId },
      select: {
        emailVerified: true,
        createdAt: true,
      },
    });
    if (!principal) {
      return response({ error: "INVALID_TOKEN" }, 401);
    }
    if (!principal.emailVerified) {
      return response({ error: "EMAIL_NOT_VERIFIED" }, 403);
    }

    const application = await getV2WebApplication();
    const reacceptance =
      application.get<LegalReacceptanceStatusCapability>(
        LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
      );
    const legal = await reacceptance.check({
      principalId: authenticated.userId,
      principalEstablishedAt: principal.createdAt,
    });
    if (legal.status === "REACCEPTANCE_REQUIRED") {
      return response(
        { error: "LEGAL_REACCEPTANCE_REQUIRED" },
        409,
      );
    }
    if (legal.status === "FAILED") {
      return response(
        {
          error:
            legal.code === "PERSISTENCE_UNAVAILABLE"
              ? "LEGAL_DOCUMENTS_UNAVAILABLE"
              : "INVALID_INPUT",
        },
        legal.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422,
      );
    }

    const input = schema.parse(await request.json());
    const account = await createOrganizationAccount({
      actorId: authenticated.userId,
      displayName: input.display_name,
      legalName: input.legal_name,
      billingEmail: input.billing_email,
      registrationNumber: input.registration_number,
      taxId: input.tax_id,
    });

    return response(
      {
        status: "created",
        switch_required: true,
        account: {
          type: "ORGANIZATION",
          display_name: account.displayName,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
