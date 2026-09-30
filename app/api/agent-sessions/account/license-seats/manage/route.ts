import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import {
  resolveAgentLicenseSeatManagementHandle,
  resolveAgentLicenseSeatTargetHandle,
  validAgentLicenseSeatManagementHandle,
  validAgentLicenseSeatTargetHandle,
} from "@/apps/web/licensing/agent-license-seat-management";
import {
  assignLicenseSeat,
  removeLicenseSeat,
} from "@/apps/web/licensing/license-seat-management";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { db } from "@/platform/host/db";

const schema = z.object({
  action: z.enum(["assign", "remove"]),
  license_management_handle: z
    .string()
    .max(128)
    .refine(
      validAgentLicenseSeatManagementHandle,
      { message: "Invalid license seat management handle." },
    ),
  target_management_handle: z
    .string()
    .max(128)
    .refine(
      validAgentLicenseSeatTargetHandle,
      { message: "Invalid license seat target handle." },
    ),
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

function protocolApiError(error: unknown) {
  const result = apiError(error);
  result.headers.set("cache-control", "no-store");
  result.headers.set(
    "x-bke-account-session-version",
    AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  );
  return result;
}

function knownSeatError(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  switch (error.message) {
    case "NOT_FOUND":
      return response({ error: "LICENSE_NOT_FOUND" }, 404);
    case "ACCOUNT_NOT_ACTIVE":
      return response({ error: "ACCOUNT_NOT_ACTIVE" }, 409);
    case "LICENSE_NOT_ACTIVE":
      return response({ error: "LICENSE_NOT_ACTIVE" }, 409);
    case "ACCOUNT_ROLE_FORBIDDEN":
      return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
    case "TARGET_NOT_ACCOUNT_MEMBER":
      return response(
        { error: "TARGET_NOT_ACCOUNT_MEMBER" },
        409,
      );
    case "LICENSE_SEAT_LIMIT":
      return response({ error: "LICENSE_SEAT_LIMIT" }, 409);
    case "INVALID_INPUT":
      return response({ error: "INVALID_INPUT" }, 400);
    default:
      return null;
  }
}

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json(
        { error: "NOT_FOUND" },
        { status: 404 },
      );
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const authenticated =
      await authenticateNativeAgentRequest(request);
    if (authenticated.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:license-seats-manage:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());
    const [licenseId, targetUserId] =
      await Promise.all([
        resolveAgentLicenseSeatManagementHandle({
          accountId: authenticated.accountId,
          handle: input.license_management_handle,
        }),
        resolveAgentLicenseSeatTargetHandle({
          accountId: authenticated.accountId,
          handle: input.target_management_handle,
        }),
      ]);

    if (!licenseId) {
      return response({ error: "LICENSE_NOT_FOUND" }, 404);
    }
    if (!targetUserId) {
      return response({ error: "TARGET_NOT_FOUND" }, 404);
    }

    try {
      const result = await db.$transaction(
        (tx) =>
          input.action === "assign"
            ? assignLicenseSeat(tx, {
                actorId: authenticated.userId,
                licenseId,
                targetUserId,
              })
            : removeLicenseSeat(tx, {
                actorId: authenticated.userId,
                licenseId,
                targetUserId,
              }),
        { isolationLevel: "Serializable" },
      );

      return response({
        status: result.status.toLowerCase(),
      });
    } catch (error) {
      return knownSeatError(error) ??
        protocolApiError(error);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
