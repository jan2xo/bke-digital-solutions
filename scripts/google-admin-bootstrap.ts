import type { PrismaClient } from "../platform/persistence/generated/prisma/client";

export interface GoogleAdministratorBootstrapInput {
  readonly userId: string;
  readonly reason: string;
  readonly operatorId: string;
  readonly deploymentEnvironment: string;
  readonly allowAdditionalAdministrator: boolean;
}

export async function bootstrapGoogleAdministrator(
  database: PrismaClient,
  input: GoogleAdministratorBootstrapInput,
) {
  if (!input.userId.trim() || !input.reason.trim() || !input.operatorId.trim()) {
    throw new Error("Target ID, authorization reason, and operator identity are required.");
  }

  const now = new Date();
  return database.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        role: true,
        suspendedAt: true,
        lifecycleState: true,
        googleIdentity: { select: { userId: true } },
      },
    });
    if (
      !user ||
      !user.googleIdentity ||
      !user.emailVerified ||
      user.suspendedAt ||
      user.lifecycleState !== "ACTIVE"
    ) {
      throw new Error("Target must be an active Google-bound user with BKE-verified contact email.");
    }
    if (user.role === "ADMIN") {
      throw new Error("Target is already an administrator; use the separate recovery procedure if required.");
    }

    const otherAdministrators = await tx.user.count({
      where: { role: "ADMIN", id: { not: user.id } },
    });
    if (otherAdministrators > 0 && !input.allowAdditionalAdministrator) {
      throw new Error(
        "Another administrator exists. Explicit authorization is required for an additional administrator.",
      );
    }

    await tx.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
    });
    const revoked = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: {
        revokedAt: now,
        revocationReason: "ADMIN_GOOGLE_BOOTSTRAP",
      },
    });
    await tx.auditLog.create({
      data: {
        action: "ADMIN_GOOGLE_BOOTSTRAP",
        targetType: "User",
        targetId: user.id,
        metadata: {
          targetEmail: user.email,
          identityMethod: "GOOGLE_OIDC",
          reason: input.reason.slice(0, 500),
          operatorId: input.operatorId.slice(0, 160),
          deploymentEnvironment: input.deploymentEnvironment,
          revokedSessions: revoked.count,
          mfaEnrollmentRequired: true,
        },
      },
    });
    return { userId: user.id, revokedSessions: revoked.count };
  }, { isolationLevel: "Serializable" });
}
