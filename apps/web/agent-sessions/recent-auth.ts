import "server-only";

import { db } from "@/platform/host/db";

export const AGENT_RECENT_AUTH_WINDOW_MINUTES = 15;
const AGENT_RECENT_AUTH_WINDOW_MS =
  AGENT_RECENT_AUTH_WINDOW_MINUTES * 60_000;

export async function markAgentSessionRecentlyAuthenticated(input: Readonly<{
  sessionId: string;
  userId: string;
  accountId: string;
  deviceId: string;
  method: "PASSWORD" | "PASSWORD_MFA";
}>) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AGENT_RECENT_AUTH_WINDOW_MS);

  const changed = await db.$transaction(async (tx) => {
    const count = await tx.$executeRaw`
      UPDATE "AgentAccountSession"
         SET "recentAuthenticatedAt" = ${now},
             "updatedAt" = NOW()
       WHERE "id" = ${input.sessionId}
         AND "userId" = ${input.userId}
         AND "accountId" = ${input.accountId}
         AND "deviceId" = ${input.deviceId}
         AND "revokedAt" IS NULL
    `;
    if (count !== 1) return false;

    await tx.auditLog.create({
      data: {
        actorId: input.userId,
        accountId: input.accountId,
        action: "AGENT_RECENT_AUTH_VERIFIED",
        targetType: "AgentAccountSession",
        targetId: input.sessionId,
        metadata: {
          channel: "BKE_AGENT_SESSION",
          deviceId: input.deviceId,
          method: input.method,
          expiresAt: expiresAt.toISOString(),
        },
      },
    });
    return true;
  }, { isolationLevel: "Serializable" });

  if (!changed) throw new Error("INVALID_TOKEN");
  return Object.freeze({
    recentAuthenticatedAt: now,
    expiresAt,
  });
}

export async function agentSessionRecentlyAuthenticated(input: Readonly<{
  sessionId: string;
  userId: string;
  accountId: string;
  deviceId: string;
  now?: Date;
}>): Promise<boolean> {
  const now = input.now ?? new Date();
  const threshold = new Date(now.getTime() - AGENT_RECENT_AUTH_WINDOW_MS);
  const rows = await db.$queryRaw<Array<{ recentAuthenticatedAt: Date | null }>>`
    SELECT "recentAuthenticatedAt"
      FROM "AgentAccountSession"
     WHERE "id" = ${input.sessionId}
       AND "userId" = ${input.userId}
       AND "accountId" = ${input.accountId}
       AND "deviceId" = ${input.deviceId}
       AND "revokedAt" IS NULL
     LIMIT 1
  `;
  const value = rows[0]?.recentAuthenticatedAt;
  return Boolean(value && value >= threshold && value <= now);
}
