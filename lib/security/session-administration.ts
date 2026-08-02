import "server-only";
import { db } from "@/lib/db";
import { securityEventDefinition } from "@/lib/security/catalog";
import { sanitizeSecurityMetadata } from "@/lib/security/events";
import { queueSecurityEmail } from "@/lib/email";

export type SessionRevocationAction = "ONE" | "OTHERS" | "ALL";

export async function revokeAdministratorSessions(input: { userId: string; currentSessionId: string; action: SessionRevocationAction; targetSessionId?: string }) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const administrator = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { email: true } });
    if (input.action === "ONE") {
      if (!input.targetSessionId) throw new Error("SESSION_NOT_FOUND");
      const target = await tx.session.findUnique({ where: { id: input.targetSessionId }, select: { userId: true, revokedAt: true } });
      if (!target) throw new Error("SESSION_NOT_FOUND");
      if (target.userId !== input.userId) throw new Error("SESSION_NOT_OWNED");
      if (!target.revokedAt) await tx.session.update({ where: { id: input.targetSessionId }, data: { revokedAt: now, revocationReason: "ADMIN_REVOKED" } });
    } else {
      await tx.session.updateMany({ where: { userId: input.userId, revokedAt: null, ...(input.action === "OTHERS" ? { id: { not: input.currentSessionId } } : {}) }, data: { revokedAt: now, revocationReason: input.action === "ALL" ? "ADMIN_REVOKED_ALL" : "ADMIN_REVOKED_OTHERS" } });
    }
    const type = input.action === "ONE" ? "ADMIN_SESSION_REVOKED" : input.action === "OTHERS" ? "ADMIN_ALL_OTHER_SESSIONS_REVOKED" : "ADMIN_ALL_SESSIONS_REVOKED";
    const definition = securityEventDefinition(type);
    await tx.securityEvent.create({ data: { userId: input.userId, sessionId: input.action === "ONE" ? input.targetSessionId : input.currentSessionId, type, outcome: definition.outcome, severity: definition.severity, metadata: sanitizeSecurityMetadata({ action: input.action }) } });
    await queueSecurityEmail(tx, { type: "SECURITY_SESSIONS_REVOKED", recipient: administrator.email, subject: "BKE administrator session access changed", deduplicationKey: `security-session-revocation:${input.userId}:${input.action}:${now.toISOString()}` });
    return { signedOut: input.action === "ALL" || (input.action === "ONE" && input.targetSessionId === input.currentSessionId) };
  });
}
