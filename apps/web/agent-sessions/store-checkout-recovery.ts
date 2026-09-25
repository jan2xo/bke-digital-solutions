import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

const LEGACY_SESSION_CANDIDATE_LIMIT = 64;

type AgentCheckoutSessionIdentity = Readonly<{
  sessionId: string;
  userId: string;
  accountId: string;
  deviceId: string;
}>;

type AgentAccountSessionIdRow = Readonly<{
  id: string;
}>;

function durableRecoveryKey(
  deviceId: string,
  userId: string,
  accountId: string,
): string {
  return createHash("sha256")
    .update(deviceId, "utf8")
    .update("\0", "utf8")
    .update(userId, "utf8")
    .update("\0", "utf8")
    .update(accountId, "utf8")
    .digest("hex");
}

export function durableAgentCheckoutSourceReference(
  session: Pick<
    AgentCheckoutSessionIdentity,
    "deviceId" | "userId" | "accountId"
  >,
  correlationId: string,
): string {
  return `agent-checkout-device:${durableRecoveryKey(
    session.deviceId,
    session.userId,
    session.accountId,
  )}:${correlationId}`;
}

function legacyAgentCheckoutSourceReference(
  sessionId: string,
  correlationId: string,
): string {
  return `agent-checkout:${sessionId}:${correlationId}`;
}

export async function agentCheckoutSourceReferenceCandidates(
  tx: Prisma.TransactionClient,
  session: AgentCheckoutSessionIdentity,
  correlationId: string,
): Promise<readonly string[]> {
  const historicalSessions = await tx.$queryRaw<AgentAccountSessionIdRow[]>`
    SELECT "id"
      FROM "AgentAccountSession"
     WHERE "deviceId" = ${session.deviceId}
       AND "userId" = ${session.userId}
       AND "accountId" = ${session.accountId}
     ORDER BY "createdAt" DESC
     LIMIT ${LEGACY_SESSION_CANDIDATE_LIMIT}
  `;

  const candidates = [
    durableAgentCheckoutSourceReference(session, correlationId),
    legacyAgentCheckoutSourceReference(session.sessionId, correlationId),
    ...historicalSessions.map((item) =>
      legacyAgentCheckoutSourceReference(item.id, correlationId)),
  ];

  return Object.freeze([...new Set(candidates)]);
}
