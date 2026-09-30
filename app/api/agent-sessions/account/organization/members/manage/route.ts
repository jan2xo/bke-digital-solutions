import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import {
  resolveAgentOrganizationMemberManagementHandle,
  validAgentOrganizationMemberManagementHandle,
} from "@/apps/web/accounts/agent-organization-member-management";
import {
  removeOrganizationMember,
  updateOrganizationMemberRole,
} from "@/apps/web/accounts/organization-operations";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const managementHandle = z
  .string()
  .max(128)
  .refine(
    (value) =>
      validAgentOrganizationMemberManagementHandle(value),
    { message: "Invalid member management handle." },
  );

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_role"),
    management_handle: managementHandle,
    role: z.enum([
      "OWNER",
      "BILLING",
      "LICENSE_MANAGER",
      "MEMBER",
    ]),
  }).strict(),
  z.object({
    action: z.literal("remove"),
    management_handle: managementHandle,
  }).strict(),
]);

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
      `agent-session:organization-member-manage:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());
    const targetUserId =
      await resolveAgentOrganizationMemberManagementHandle({
        accountId: authenticated.accountId,
        handle: input.management_handle,
      });

    if (!targetUserId) {
      return response({ error: "MEMBER_NOT_FOUND" }, 404);
    }

    if (input.action === "update_role") {
      await updateOrganizationMemberRole({
        actorId: authenticated.userId,
        accountId: authenticated.accountId,
        userId: targetUserId,
        role: input.role,
      });
      return response({ status: "updated" });
    }

    await removeOrganizationMember({
      actorId: authenticated.userId,
      accountId: authenticated.accountId,
      userId: targetUserId,
    });
    return response({ status: "removed" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
