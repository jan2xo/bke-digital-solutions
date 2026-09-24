import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { consumeClaimCode } from "@/apps/web/entitlements/claim-codes";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  code: z.string().trim().min(16).max(128),
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

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const accessToken = bearerToken(request);
    if (!accessToken) return json({ error: "INVALID_TOKEN" }, 401);

    if (!(await rateLimit(
      `agent-session:claim-redeem:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());

    const result = await db.$transaction(async (tx) => {
      const session = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (session.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      let account;
      try {
        account = await requireClaimAccountCapabilityInTransaction(
          tx,
          session.userId,
          session.accountId,
          "CLAIM_ENTITLEMENT",
        );
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "ACCOUNT_ROLE_FORBIDDEN") {
          return { status: "account_forbidden" as const };
        }
        if (code === "NOT_FOUND") {
          return { status: "account_not_found" as const };
        }
        throw error;
      }
      if (account.lifecycleState === "SUSPENDED") {
        return { status: "suspended_account" as const };
      }
      if (account.lifecycleState === "CLOSED") {
        return { status: "closed_account" as const };
      }
      if (account.lifecycleState !== "ACTIVE") {
        return { status: "account_not_active" as const };
      }

      const claim = await consumeClaimCode(tx, {
        code: input.code,
        userId: session.userId,
        accountId: session.accountId,
      });

      if (claim.status === "CLAIMED") {
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            accountId: session.accountId,
            action: "CLAIM_CODE_REDEEMED",
            targetType: "Entitlement",
            targetId: claim.entitlementId,
            metadata: {
              acquisition: "CLAIM_CODE",
              channel: "BKE_AGENT_SESSION",
              sessionId: session.sessionId,
              deviceId: session.deviceId,
            },
          },
        });
      }

      return claim.status === "CLAIMED"
        ? {
            status: "claimed" as const,
            entitlementId: claim.entitlementId,
            accountId: claim.accountId,
          }
        : {
            status: "rejected" as const,
            code: claim.code,
          };
    }, { isolationLevel: "Serializable" });

    switch (result.status) {
      case "invalid_token":
        return json({ error: "INVALID_TOKEN" }, 401);
      case "account_forbidden":
        return json({ status: "account_forbidden" }, 403);
      case "account_not_found":
        return json({ status: "account_not_found" }, 404);
      case "suspended_account":
        return json({ status: "suspended_account" }, 409);
      case "closed_account":
        return json({ status: "closed_account" }, 409);
      case "account_not_active":
        return json({ status: "account_not_active" }, 403);
      case "claimed":
        return json({
          status: "claimed",
          entitlement_id: result.entitlementId,
          account_id: result.accountId,
        }, 201);
      case "rejected":
        switch (result.code) {
          case "INVALID_CODE":
            return json({ status: "claim_code_not_found" }, 404);
          case "ALREADY_CLAIMED":
            return json({ status: "claim_code_already_used" }, 409);
          case "REVOKED":
            return json({ status: "claim_code_revoked" }, 409);
          case "EXPIRED":
            return json({ status: "claim_code_expired" }, 410);
        }
    }
  } catch (error) {
    return apiError(error);
  }
}
