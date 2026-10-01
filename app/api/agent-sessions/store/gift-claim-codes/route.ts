import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { giftClaimHandle } from "@/apps/web/agent-sessions/gift-claim-handles";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { assertLegalAcceptanceCurrent } from "@/apps/web/legal/service";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  correlation_id: z.string().trim().min(16).max(128)
    .regex(/^[A-Za-z0-9._:-]+$/),
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
      `agent-session:gift-claims-list:${session.userId}:${session.accountId}:${clientIp(request)}`,
      120,
      3600,
    )).allowed) {
      return response({ error: "RATE_LIMITED" }, 429);
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

      const claims = await tx.$queryRaw<Array<{
        id: string;
        orderNumber: string;
        productName: string;
        editionName: string | null;
        planName: string | null;
        lastFour: string;
        status: "AVAILABLE" | "CLAIMED" | "REVOKED" | "EXPIRED";
        createdAt: Date;
        expiresAt: Date | null;
      }>>`
        SELECT cc."id",
               o."number" AS "orderNumber",
               oi."productName",
               oi."editionName",
               oi."planName",
               cc."codeLastFour" AS "lastFour",
               cc."status"::text AS "status",
               cc."createdAt",
               cc."expiresAt"
          FROM "ClaimCode" cc
          JOIN "Order" o ON o."id" = cc."orderId"
          JOIN "OrderItem" oi ON oi."id" = cc."orderItemId"
         WHERE cc."purchaserAccountId" = ${session.accountId}
         ORDER BY cc."createdAt" DESC
         LIMIT 100
      `;

      return {
        status: "ready" as const,
        lifecycleState: account.lifecycleState,
        claims,
      };
    }, { isolationLevel: "Serializable" });

    if (result.status === "account_forbidden") {
      return response({ status: "account_forbidden" }, 403);
    }
    if (result.status === "account_not_found") {
      return response({ status: "account_not_found" }, 404);
    }

    return response({
      status: "ready",
      correlation_id: input.correlation_id,
      account_lifecycle_state: result.lifecycleState,
      claims: result.claims.map((claim) => ({
        gift_claim_handle: giftClaimHandle(
          claim.id,
          session.accountId,
          runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
        ),
        order_number: claim.orderNumber,
        product_name: claim.productName,
        edition_name: claim.editionName,
        plan_name: claim.planName,
        last_four: claim.lastFour,
        status: claim.status,
        created_at: claim.createdAt.toISOString(),
        expires_at: claim.expiresAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return response({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}
