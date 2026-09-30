import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import {
  resolveAgentOrganizationInvitationManagementHandle,
  validAgentOrganizationInvitationManagementHandle,
} from "@/apps/web/accounts/agent-organization-invitation-management";
import {
  expirePendingOrganizationInvitations,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
} from "@/apps/web/accounts/organization-operations";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z
  .object({
    action: z.enum(["resend", "revoke"]),
    management_handle: z.string().max(128),
  })
  .strict()
  .refine(
    (input) =>
      validAgentOrganizationInvitationManagementHandle(
        input.management_handle,
      ),
    { message: "Invalid invitation management handle." },
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

function safeInvitation(invitation: {
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}) {
  return {
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expires_at: invitation.expiresAt.toISOString(),
    created_at: invitation.createdAt.toISOString(),
  };
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
      `agent-session:organization-invitation-manage:${authenticated.userId}:${authenticated.accountId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());

    await expirePendingOrganizationInvitations();

    const invitationId =
      await resolveAgentOrganizationInvitationManagementHandle({
        accountId: authenticated.accountId,
        handle: input.management_handle,
      });

    if (!invitationId) {
      return response({ error: "INVITATION_NOT_FOUND" }, 404);
    }

    if (input.action === "resend") {
      const result = await resendOrganizationInvitation({
        actorId: authenticated.userId,
        invitationId,
      });
      return response({
        status: "resent",
        invitation: safeInvitation(result.invitation),
        invitation_code: result.token,
      });
    }

    const invitation = await revokeOrganizationInvitation({
      actorId: authenticated.userId,
      invitationId,
    });
    return response({
      status: "revoked",
      invitation: safeInvitation(invitation),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return protocolApiError(error);
  }
}
