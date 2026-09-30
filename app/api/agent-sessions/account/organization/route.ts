import { NextResponse } from "next/server";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateNativeAgentRequest } from "@/apps/web/agent-sessions/native-mfa";
import { getAgentOrganizationOverview } from "@/apps/web/accounts/agent-organization-overview";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

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

export async function GET(request: Request) {
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
      `agent-session:organization-overview:${authenticated.userId}:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const overview = await getAgentOrganizationOverview({
      principalId: authenticated.userId,
      accountId: authenticated.accountId,
    });

    if (overview.status === "not_organization") {
      return response({ status: "not_organization" });
    }
    if (overview.status === "forbidden") {
      return response({ error: "ACCOUNT_FORBIDDEN" }, 403);
    }
    if (overview.status !== "ready") {
      return response({ error: "ORGANIZATION_UNAVAILABLE" }, 503);
    }

    return response({
      status: "ready",
      account: {
        type: "ORGANIZATION",
        display_name: overview.displayName,
        lifecycle_state: overview.lifecycleState,
        role: overview.role,
      },
      permissions: {
        manage_members: overview.permissions.manageMembers,
        view_billing: overview.permissions.viewBilling,
        view_licenses: overview.permissions.viewLicenses,
      },
      organization: {
        legal_name: overview.organization.legalName,
        registration_number:
          overview.organization.registrationNumber,
      },
      billing_email: overview.billingEmail,
      tax_id: overview.taxId,
      counts: overview.counts,
      members: overview.members.map((member) => ({
        email: member.email,
        name: member.name,
        role: member.role,
      })),
      invitations: overview.invitations.map((invitation) => ({
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expires_at: invitation.expiresAt.toISOString(),
        created_at: invitation.createdAt.toISOString(),
        management_handle: invitation.managementHandle,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
