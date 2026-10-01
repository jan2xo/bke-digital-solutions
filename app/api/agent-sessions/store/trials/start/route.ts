import {
  ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
  type AccountsPurchaseAccessCapability,
} from "@bke/accounts/contracts/purchase-access.contract";
import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  type IdentityLookupCapability,
} from "@bke/identity/contracts/identity.contract";
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
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { grantProductTrial } from "@/apps/web/trials/service";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  correlation_id: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  edition_id: z.string().cuid(),
}).strict();

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

function errorResponse(error: unknown) {
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

    const accessToken = bearerToken(request);
    if (!accessToken) {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    const input = schema.parse(await request.json());

    const session = await db.$transaction(
      (tx) => authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );
    if (session.status !== "authenticated") {
      return json({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:trial-start:${session.userId}:${session.accountId}:${clientIp(request)}`,
      5,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const application = await getV2WebApplication();

    const identity = application.get<IdentityLookupCapability>(
      IDENTITY_LOOKUP_CAPABILITY_ID,
    );
    const identityResult = await identity.findById(session.userId);
    if (identityResult.status === "FAILED") {
      return json({ error: "IDENTITY_UNAVAILABLE" }, 503);
    }
    if (
      identityResult.status !== "FOUND" ||
      !identityResult.principal.emailVerified ||
      identityResult.principal.lifecycleState !== "ACTIVE"
    ) {
      return json({ error: "INVALID_TOKEN" }, 401);
    }
    const principal = identityResult.principal;

    const reacceptance = application.get<LegalReacceptanceStatusCapability>(
      LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
    );
    const reacceptanceStatus = await reacceptance.check({
      principalId: principal.id,
      principalEstablishedAt: principal.establishedAt,
    });
    if (reacceptanceStatus.status === "REACCEPTANCE_REQUIRED") {
      return json({ error: "LEGAL_REACCEPTANCE_REQUIRED" }, 409);
    }
    if (reacceptanceStatus.status === "FAILED") {
      return json({ error: "LEGAL_DOCUMENTS_UNAVAILABLE" }, 503);
    }

    const purchaseAccess = application.get<AccountsPurchaseAccessCapability>(
      ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID,
    );
    const access = await purchaseAccess.authorize({
      principalId: principal.id,
      accountId: session.accountId,
    });
    if (access.status === "FAILED") {
      return json({ error: "ACCOUNT_UNAVAILABLE" }, 503);
    }
    if (access.status === "REJECTED") {
      return json(
        {
          error: access.code === "ACCOUNT_ROLE_FORBIDDEN"
            ? "FORBIDDEN"
            : access.code,
        },
        access.code === "ACCOUNT_ROLE_FORBIDDEN" ? 403 : 409,
      );
    }

    const trial = await grantProductTrial({
      accountId: access.account.id,
      editionId: input.edition_id,
      source: "SELF_SERVICE",
      actorId: principal.id,
    });

    return json(
      {
        status: "started",
        correlation_id: input.correlation_id,
        trial_ends_at: trial.trialEndsAt.toISOString(),
        grace_ends_at: trial.graceEndsAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return errorResponse(error);
  }
}
