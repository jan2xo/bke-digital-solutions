import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { listAccountProductNotifications } from "@/apps/web/notifications/center";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const querySchema = z.object({
  product_id: z.string().trim().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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

export async function GET(request: Request) {
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
      `agent-session:notifications:${clientIp(request)}`,
      300,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const url = new URL(request.url);
    const input = querySchema.parse({
      product_id: url.searchParams.get("product_id"),
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const result = await db.$transaction(async (tx) => {
      const session = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (session.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      const product = await tx.product.findFirst({
        where: {
          productId: input.product_id,
          active: true,
          archivedAt: null,
        },
        select: { id: true, productId: true },
      });
      if (!product) {
        return { status: "not_found" as const };
      }

      const [license, subscription, trial, orderItem] = await Promise.all([
        tx.license.findFirst({
          where: { accountId: session.accountId, productId: product.id },
          select: { id: true },
        }),
        tx.subscription.findFirst({
          where: { accountId: session.accountId, productId: product.id },
          select: { id: true },
        }),
        tx.trialGrant.findFirst({
          where: { accountId: session.accountId, productId: product.id },
          select: { id: true },
        }),
        tx.orderItem.findFirst({
          where: {
            productId: product.id,
            order: { accountId: session.accountId },
          },
          select: { id: true },
        }),
      ]);
      if (!license && !subscription && !trial && !orderItem) {
        return { status: "not_found" as const };
      }

      return {
        status: "ok" as const,
        accountId: session.accountId,
        productInternalId: product.id,
        productId: product.productId!,
      };
    }, { isolationLevel: "Serializable" });

    if (result.status === "invalid_token") {
      return json({ error: "INVALID_TOKEN" }, 401);
    }
    if (result.status === "not_found") {
      return json({ status: "not_found" }, 404);
    }

    const notifications = await listAccountProductNotifications({
      accountId: result.accountId,
      productId: result.productInternalId,
      limit: input.limit,
    });

    return json({
      status: "ok",
      account_id: result.accountId,
      product_id: result.productId,
      notifications: notifications.map((notification) => ({
        id: notification.id,
        source: notification.source,
        event: notification.event,
        title: notification.title,
        body: notification.body,
        category: notification.category,
        priority: notification.priority,
        created_at: notification.createdAt,
        expires_at: notification.expiresAt,
        data: notification.data,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
