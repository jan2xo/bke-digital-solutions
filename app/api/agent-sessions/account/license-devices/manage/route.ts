import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import {
  resolveAgentLicenseDeviceManagementHandle,
  resolveAgentLicenseDeviceTargetHandle,
  validAgentLicenseDeviceManagementHandle,
  validAgentLicenseDeviceTargetHandle,
} from "@/apps/web/licensing/agent-license-device-management";
import { deactivateAgentLicenseDevice } from "@/apps/web/licensing/agent-license-device-authority";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  license_management_handle: z
    .string()
    .max(128)
    .refine(
      validAgentLicenseDeviceManagementHandle,
      { message: "Invalid license device management handle." },
    ),
  device_management_handle: z
    .string()
    .max(160)
    .refine(
      validAgentLicenseDeviceTargetHandle,
      { message: "Invalid device management handle." },
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
      `agent-session:license-devices-manage:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());
    const licenseId =
      await resolveAgentLicenseDeviceManagementHandle({
        accountId: authenticated.accountId,
        handle: input.license_management_handle,
      });

    if (!licenseId) {
      return response({ error: "LICENSE_NOT_FOUND" }, 404);
    }

    const deviceActivationId =
      await resolveAgentLicenseDeviceTargetHandle({
        accountId: authenticated.accountId,
        licenseId,
        handle: input.device_management_handle,
      });

    if (!deviceActivationId) {
      return response({ error: "DEVICE_NOT_FOUND" }, 404);
    }

    const result = await deactivateAgentLicenseDevice({
      principalId: authenticated.userId,
      accountId: authenticated.accountId,
      licenseId,
      deviceActivationId,
    });

    switch (result.status) {
      case "deactivated":
        return response({ status: "deactivated" });
      case "device_not_found":
        return response({ error: "DEVICE_NOT_FOUND" }, 404);
      case "account_not_active":
        return response({ error: "ACCOUNT_NOT_ACTIVE" }, 409);
      case "account_forbidden":
        return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
      case "failed":
        return response(
          { error: "LICENSE_DEVICE_DEACTIVATE_UNAVAILABLE" },
          503,
        );
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
