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
  validAgentLicenseSeatManagementHandle,
} from "@/apps/web/licensing/agent-license-seat-management";
import { getAgentLicenseSeatOverview } from "@/apps/web/licensing/agent-license-seat-overview";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  management_handle: z
    .string()
    .max(128)
    .refine(
      validAgentLicenseSeatManagementHandle,
      { message: "Invalid license seat management handle." },
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
      `agent-session:license-seats-read:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());
    const licenseId =
      await resolveAgentLicenseSeatManagementHandle({
        accountId: authenticated.accountId,
        handle: input.management_handle,
      });

    if (!licenseId) {
      return response({ error: "LICENSE_NOT_FOUND" }, 404);
    }

    const overview = await getAgentLicenseSeatOverview({
      principalId: authenticated.userId,
      accountId: authenticated.accountId,
      licenseId,
    });

    switch (overview.status) {
      case "not_found":
        return response({ error: "LICENSE_NOT_FOUND" }, 404);
      case "account_not_active":
        return response({ error: "ACCOUNT_NOT_ACTIVE" }, 409);
      case "license_not_active":
        return response({ error: "LICENSE_NOT_ACTIVE" }, 409);
      case "account_forbidden":
        return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
      case "failed":
        return response(
          { error: "LICENSE_SEATS_UNAVAILABLE" },
          503,
        );
    }

    return response({
      status: "ready",
      license: {
        product_name: overview.license.productName,
        edition_name: overview.license.editionName,
        key_last_four: overview.license.keyLastFour,
        max_seats: overview.license.maxSeats,
        assigned_seats: overview.license.assignedSeats,
        available_seats: overview.license.availableSeats,
      },
      targets: overview.targets.map((target) => ({
        email: target.email,
        name: target.name,
        assigned: target.assigned,
        eligible: target.eligible,
        management_handle: target.managementHandle,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
