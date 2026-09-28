import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  authenticateAgentAccessToken,
  revokeAgentAccountSessionsForUser,
} from "@/apps/web/agent-sessions/device-authorization";
import { hashPassword, verifyPassword } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { passwordSchema } from "@/apps/web/http/validation";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: passwordSchema,
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
      `agent-session:password-change:${clientIp(request)}`,
      10,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const input = schema.parse(await request.json());

    const result = await db.$transaction(async (tx) => {
      const authenticated = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (authenticated.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      const credential = await tx.passwordCredential.findUnique({
        where: { userId: authenticated.userId },
        select: { passwordHash: true },
      });
      if (!credential) {
        return { status: "invalid_credentials" as const };
      }

      let currentPasswordValid = false;
      try {
        currentPasswordValid = await verifyPassword(
          credential.passwordHash,
          input.current_password,
        );
      } catch {
        return { status: "password_provider_unavailable" as const };
      }
      if (!currentPasswordValid) {
        return { status: "invalid_credentials" as const };
      }

      let passwordHash: string;
      try {
        passwordHash = await hashPassword(input.new_password);
      } catch {
        return { status: "password_provider_unavailable" as const };
      }

      const changedAt = new Date();
      await tx.passwordCredential.update({
        where: { userId: authenticated.userId },
        data: {
          passwordHash,
          changedAt,
        },
      });

      await tx.session.updateMany({
        where: {
          userId: authenticated.userId,
          revokedAt: null,
        },
        data: {
          revokedAt: changedAt,
          revocationReason: "PASSWORD_CHANGED",
        },
      });

      await revokeAgentAccountSessionsForUser(
        tx,
        authenticated.userId,
        changedAt,
      );

      await tx.securityEvent.create({
        data: {
          userId: authenticated.userId,
          type: "PASSWORD_CHANGED",
          outcome: "SUCCESS",
          severity: "HIGH",
          authenticationMethod: "PASSWORD",
          metadata: {
            channel: "BKE_AGENT_SESSION",
            agentSessionId: authenticated.sessionId,
            deviceId: authenticated.deviceId,
            reauthenticationRequired: true,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: authenticated.userId,
          accountId: authenticated.accountId,
          action: "PASSWORD_CHANGED",
          targetType: "User",
          targetId: authenticated.userId,
          metadata: {
            channel: "BKE_AGENT_SESSION",
            sessionId: authenticated.sessionId,
            deviceId: authenticated.deviceId,
            reauthenticationRequired: true,
          },
        },
      });

      return {
        status: "changed" as const,
        userId: authenticated.userId,
        sessionId: authenticated.sessionId,
      };
    }, { isolationLevel: "Serializable" });

    switch (result.status) {
      case "invalid_token":
        return json({ error: "INVALID_TOKEN" }, 401);
      case "invalid_credentials":
        return json({ error: "INVALID_CREDENTIALS" }, 401);
      case "password_provider_unavailable":
        return json({ error: "PASSWORD_PROVIDER_UNAVAILABLE" }, 503);
      case "changed":
        return json({
          status: "changed",
          reauthentication_required: true,
        });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: "INVALID_INPUT" }, 400);
    }
    return apiError(error);
  }
}
