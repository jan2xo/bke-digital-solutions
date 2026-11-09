import "server-only";
import { db } from "@/platform/host/db";
export const AGENT_RECENT_AUTH_WINDOW_MINUTES = 15;
const AGENT_RECENT_AUTH_WINDOW_MS = AGENT_RECENT_AUTH_WINDOW_MINUTES * 60_000;

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
