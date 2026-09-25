import {
  COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID,
  type CommerceOrderSourceLookupCapability,
} from "@bke/commerce/contracts/order-source-lookup.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { agentCheckoutSourceReferenceCandidates } from "@/apps/web/agent-sessions/store-checkout-recovery";
import { requireClaimAccountCapabilityInTransaction } from "@/apps/web/accounts/claim-code-authorization";
import { revealClaimCode } from "@/apps/web/entitlements/claim-codes";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  correlation_id: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
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
      `agent-session:gift-claim-reveal:${session.userId}:${clientIp(request)}`,
      60,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const sourceReferences = await db.$transaction(
      (tx) =>
        agentCheckoutSourceReferenceCandidates(
          tx,
          session,
          input.correlation_id,
        ),
      { isolationLevel: "Serializable" },
    );
    const application = await getV2WebApplication();
    const orderLookup = application.get<CommerceOrderSourceLookupCapability>(
      COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID,
    );

    let sourceReference: string | null = null;
    let order:
      | Awaited<ReturnType<CommerceOrderSourceLookupCapability["find"]>> extends
          { status: "FOUND"; value: infer TValue }
        ? TValue
        : never
      | null = null;

    for (const candidate of sourceReferences) {
      const orderResult = await orderLookup.find({ sourceReference: candidate });
      if (orderResult.status === "FAILED") {
        return json({ error: "COMMERCE_UNAVAILABLE" }, 503);
      }
      if (orderResult.status === "FOUND") {
        sourceReference = candidate;
        order = orderResult.value;
        break;
      }
    }

    if (!sourceReference || !order) {
      return json({
        status: "not_found",
        correlation_id: input.correlation_id,
      });
    }

    if (
      order.sourceReference !== sourceReference ||
      order.accountId !== session.accountId
    ) {
      return json({ error: "FORBIDDEN" }, 403);
    }
    if (order.fulfillmentMode !== "CLAIM_CODE") {
      return json({ error: "NOT_GIFT_ORDER" }, 409);
    }
    if (order.status === "CANCELLED") {
      return json({
        status: "cancelled",
        correlation_id: input.correlation_id,
        order_id: order.orderId,
      });
    }
    if (order.totalMinor > 0 && order.paidAt === null) {
      return json({
        status: "not_ready",
        correlation_id: input.correlation_id,
        order_id: order.orderId,
      });
    }

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

      const claims = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
          FROM "ClaimCode"
         WHERE "orderId" = ${order.orderId}
           AND "purchaserAccountId" = ${session.accountId}
         ORDER BY "unitIndex" ASC
         LIMIT 2
      `;
      if (claims.length === 0) {
        return { status: "fulfillment_pending" as const };
      }
      if (claims.length !== 1) {
        return { status: "claim_cardinality_conflict" as const };
      }

      const reveal = await revealClaimCode(tx, {
        claimCodeId: claims[0]!.id,
        purchaserAccountId: session.accountId,
      });
      if (reveal.status === "AVAILABLE") {
        await tx.auditLog.create({
          data: {
            actorId: session.userId,
            accountId: session.accountId,
            action: "CLAIM_CODE_REVEALED",
            targetType: "ClaimCode",
            targetId: claims[0]!.id,
            metadata: {
              channel: "BKE_AGENT_SESSION",
              sessionId: session.sessionId,
              deviceId: session.deviceId,
              orderId: order.orderId,
              correlationId: input.correlation_id,
            },
          },
        });
        return {
          status: "available" as const,
          claimCodeId: claims[0]!.id,
          claimCode: reveal.code,
        };
      }
      if (reveal.status === "FAILED") {
        return { status: "reveal_unavailable" as const };
      }
      return {
        status: "rejected" as const,
        code: reveal.code,
      };
    }, { isolationLevel: "Serializable" });

    switch (result.status) {
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
      case "fulfillment_pending":
        return json({
          status: "fulfillment_pending",
          correlation_id: input.correlation_id,
          order_id: order.orderId,
        });
      case "claim_cardinality_conflict":
        return json({ error: "CLAIM_CODE_CARDINALITY_CONFLICT" }, 409);
      case "reveal_unavailable":
        return json({ error: "CLAIM_CODE_UNAVAILABLE" }, 503);
      case "available":
        return json({
          status: "available",
          correlation_id: input.correlation_id,
          order_id: order.orderId,
          claim_code_id: result.claimCodeId,
          claim_code: result.claimCode,
        });
      case "rejected":
        switch (result.code) {
          case "NOT_FOUND":
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
