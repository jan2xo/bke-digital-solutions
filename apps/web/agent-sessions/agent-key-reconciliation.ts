import "server-only";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { authenticateAgentAccessToken } from "./device-authorization";

/** Session-owned metadata recovery: not proof of possession or lease rights. */
type Row = {
  id: string; sessionId: string; accountId: string; userId: string; deviceId: string;
  keyThumbprint: string; status: "PENDING" | "ACTIVE" | "REVOKED"; validUntil: Date;
};
export async function readAgentKeyRegistrationState(
  tx: Prisma.TransactionClient,
  input: Readonly<{ accessToken: string; pepper: string; registrationId?: string }>,
  now = new Date(),
) {
  const authenticated = await authenticateAgentAccessToken(tx, input);
  if (authenticated.status !== "authenticated")
    return { status: "denied" as const, reason: "INVALID_TOKEN" as const };
  const session = authenticated;
  const rows = input.registrationId
    ? await tx.$queryRaw<Row[]>`
        SELECT "id","sessionId","accountId","userId","deviceId",
               "keyThumbprint","status","validUntil"
        FROM "AgentLeaseKeyRegistration"
        WHERE "id" = \${input.registrationId} AND "sessionId" = \${session.sessionId}
        LIMIT 2
      `
    : await tx.$queryRaw<Row[]>`
        SELECT "id","sessionId","accountId","userId","deviceId",
               "keyThumbprint","status","validUntil"
        FROM "AgentLeaseKeyRegistration"
        WHERE "sessionId" = \${session.sessionId} AND "status" IN ('PENDING','ACTIVE')
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT 2
      `;
  if (rows.length > 1) return { status: "denied" as const, reason: "REGISTRATION_CONFLICT" as const };
  const key = rows[0];
  if (!key) return { status: "none" as const };
  if (key.sessionId !== session.sessionId ||
      key.accountId !== session.accountId ||
      key.userId !== session.userId || key.deviceId !== session.deviceId)
    return { status: "denied" as const, reason: "KEY_REVOKED" as const };
  return {
    status: "registration" as const,
    registrationId: key.id, keyThumbprint: key.keyThumbprint,
    keyProtection: "software" as const,
    registrationState: key.status === "REVOKED" ? "revoked" as const :
      key.validUntil <= now ? "expired" as const :
      key.status === "ACTIVE" ? "active" as const : "pending" as const,
    validUntil: key.validUntil,
  };
}
