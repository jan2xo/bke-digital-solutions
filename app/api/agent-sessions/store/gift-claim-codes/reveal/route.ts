import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import {
  giftClaimHandleMatches,
  validGiftClaimHandle,
} from "@/apps/web/agent-sessions/gift-claim-handles";
import { agentSessionRecentlyAuthenticated } from "@/apps/web/agent-sessions/recent-auth";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { revealClaimCode } from "@/apps/web/entitlements/claim-codes";
import { assertLegalAcceptanceCurrent } from "@/apps/web/legal/service";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  correlation_id: z.string().trim().min(16).max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
  gift_claim_handle: z.string().trim().min(1).max(128),
}).strict();

function bearerToken(request: Request): string | null {
  const authorization =
    request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

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

    const token = bearerToken(request);
    if (!token) return response({ error: "INVALID_TOKEN" }, 401);
    const input = schema.parse(await request.json());
    if (!validGiftClaimHandle(input.gift_claim_handle)) {
      return response({ error: "INVALID_INPUT" }, 400);
    }

    const session = await db.$transaction(
      (tx) => authenticateAgentAccessToken(tx, {
        accessToken: token,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      }),
      { isolationLevel: "Serializable" },
    );
    if (session.status !== "authenticated") {
      return response({ error: "INVALID_TOKEN" }, 401);
    }

    if (!(await rateLimit(
      `agent-session:gift-claims-reveal:${session.userId}:${session.accountId}:${clientIp(request)}`,
      30,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    if (!(await agentSessionRecentlyAuthenticated(session))) {
      return response({
        status: "recent_auth_required",
        correlation_id: input.correlation_id,
      }, 409);
    }

    await assertLegalAcceptanceCurrent(session.userId);

    const result = await db.$transaction(async (tx) => {
      let account;
      try {
        account = await requireClaimAccountCapabilityInTransaction(
          tx,
          session.userId,
          session.accountId,
          "MANAGE_CLAIM_CODES",
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

      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
          FROM "ClaimCode"
         WHERE "purchaserAccountId" = ${session.accountId}
         ORDER BY "createdAt" DESC
         LIMIT 100
      `;

      const matched = candidates.find((candidate) =>
        giftClaimHandleMatches(
          input.gift_claim_handle,
          candidate.id,
          session.accountId,
          runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
        )
      );
      if (!matched) return { status: "claim_not_found" as const };

      const reveal = await revealClaimCode(tx, {
        claimCodeId: matched.id,
        purchaserAccountId: session.accountId,
      });
      if (reveal.status === "FAILED") {
        return { status: "reveal_unavailable" as const };
      }
      if (reveal.status === "REJECTED") {
        return {
          status: "rejected" as const,
          code: reveal.code,
        };
      }

      await tx.auditLog.create({
        data: {
          actorId: session.userId,
          accountId: session.accountId,
          action: "CLAIM_CODE_REVEALED",
          targetType: "ClaimCode",
          targetId: matched.id,
          metadata: {
            channel: "BKE_AGENT_SESSION_PERSISTENT_GIFT",
            sessionId: session.sessionId,
            deviceId: session.deviceId,
          },
        },
      });

      return {
        status: "available" as const,
        claimCode: reveal.code,
      };
    }, { isolationLevel: "Serializable" });

    switch (result.status) {
      case "account_forbidden":
        return response({ status: "account_forbidden" }, 403);
      case "account_not_found":
        return response({ status: "account_not_found" }, 404);
      case "suspended_account":
      case "closed_account":
      case "account_not_active":
        return response({ status: result.status }, 409);
      case "claim_not_found":
        return response({
          status: "claim_code_not_found",
          correlation_id: input.correlation_id,
        }, 404);
      case "reveal_unavailable":
        return response(
          { error: "CLAIM_CODE_UNAVAILABLE" },
          503,
        );
      case "available":
        return response({
          status: "available",
          correlation_id: input.correlation_id,
          gift_claim_handle: input.gift_claim_handle,
          claim_code: result.claimCode,
        });
      case "rejected":
        switch (result.code) {
          case "NOT_FOUND":
            return response({ status: "claim_code_not_found" }, 404);
          case "ALREADY_CLAIMED":
            return response({ status: "claim_code_already_used" }, 409);
          case "REVOKED":
            return response({ status: "claim_code_revoked" }, 409);
          case "EXPIRED":
            return response({ status: "claim_code_expired" }, 410);
        }
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}
