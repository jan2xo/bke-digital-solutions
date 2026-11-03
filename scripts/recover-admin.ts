import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";
import { revokeAgentAccountSessionsForUser } from "../apps/web/agent-sessions/device-authorization";
import {
  createEmergencyEnrollmentToken,
  verifyOwnerRecoverySecret,
} from "../lib/emergency-mfa";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const protectedEnvironment = ["staging", "production"].includes(
  process.env.DEPLOYMENT_ENV ?? "development",
);

async function ask(
  rl: ReturnType<typeof createInterface>,
  key: string,
  prompt: string,
): Promise<string> {
  return (process.env[key] ?? await rl.question(prompt)).trim();
}

async function main() {
  if (
    protectedEnvironment &&
    process.env.ADMIN_RECOVERY_ACK !==
      "I_UNDERSTAND_THIS_RESETS_ADMINISTRATOR_MFA"
  ) {
    throw new Error("Set ADMIN_RECOVERY_ACK to the documented acknowledgement.");
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ownerSecret = await ask(rl, "ADMIN_RECOVERY_OWNER_SECRET", "Owner recovery secret: ");
    if (!verifyOwnerRecoverySecret(ownerSecret)) {
      throw new Error("Invalid owner recovery secret.");
    }

    const userId = await ask(rl, "ADMIN_RECOVERY_USER_ID", "Existing Google-bound administrator user ID: ");
    const confirmation = await ask(rl, "ADMIN_RECOVERY_CONFIRM", `Type ${userId} to confirm recovery: `);
    const reason = await ask(rl, "ADMIN_RECOVERY_REASON", "Mandatory recovery reason: ");
    const operator = await ask(rl, "ADMIN_RECOVERY_OPERATOR_ID", "Deployment operator identity: ");
    if (!userId || confirmation !== userId || !reason || !operator) {
      throw new Error("Target ID, exact confirmation, reason, and operator identity are required.");
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        role: true,
        lifecycleState: true,
        suspendedAt: true,
        googleIdentity: { select: { userId: true } },
      },
    });
    if (
      !user ||
      user.role !== "ADMIN" ||
      !user.googleIdentity ||
      !user.emailVerified ||
      user.suspendedAt ||
      user.lifecycleState !== "ACTIVE"
    ) {
      throw new Error("An active Google-bound administrator with BKE-verified contact email is required.");
    }

    const enrollment = createEmergencyEnrollmentToken();
    const now = new Date();
    const result = await db.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerified: true,
          lifecycleState: true,
          suspendedAt: true,
          googleIdentity: { select: { userId: true } },
        },
      });
      if (
        !current ||
        current.role !== "ADMIN" ||
        !current.googleIdentity ||
        !current.emailVerified ||
        current.suspendedAt ||
        current.lifecycleState !== "ACTIVE"
      ) {
        throw new Error("Administrator identity changed during recovery.");
      }

      await tx.emergencyMfaEnrollmentAuthorization.updateMany({
        where: { userId: user.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      const [mfa, recovery, challenges, sessions] = await Promise.all([
        tx.administratorMfaMethod.deleteMany({ where: { userId: user.id } }),
        tx.administratorRecoveryCode.deleteMany({ where: { userId: user.id } }),
        tx.mfaChallenge.deleteMany({ where: { userId: user.id } }),
        tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: {
            revokedAt: now,
            revocationReason: "ADMIN_EMERGENCY_MFA_RECOVERY",
          },
        }),
      ]);
      await revokeAgentAccountSessionsForUser(tx, user.id, now);
      await tx.auditLog.create({
        data: {
          action: "ADMIN_EMERGENCY_MFA_RECOVERY",
          targetType: "User",
          targetId: user.id,
          metadata: {
            targetEmail: user.email,
            reason: reason.slice(0, 500),
            recoveryMethod: "DEPLOYMENT_OPERATOR",
            operatorId: operator.slice(0, 160),
            deploymentEnvironment: process.env.DEPLOYMENT_ENV ?? "development",
            invalidated: {
              mfaMethods: mfa.count,
              recoveryCodes: recovery.count,
              challenges: challenges.count,
              sessions: sessions.count,
              agentSessionFamiliesRevoked: true,
            },
          },
        },
      });
      await tx.emergencyMfaEnrollmentAuthorization.create({
        data: {
          userId: user.id,
          tokenHash: enrollment.tokenHash,
          expiresAt: enrollment.expiresAt,
          recoveryReason: reason.slice(0, 500),
          operatorIdentity: operator.slice(0, 160),
          ownerKeyVersion: Number(process.env.ADMIN_OWNER_RECOVERY_KEY_VERSION ?? 1),
          deploymentEnvironment: process.env.DEPLOYMENT_ENV ?? "development",
        },
      });
      return {
        mfaMethods: mfa.count,
        recoveryCodes: recovery.count,
        challenges: challenges.count,
        sessions: sessions.count,
      };
    }, { isolationLevel: "Serializable" });

    process.stdout.write(
      `Emergency MFA recovery completed for ${user.email}. Enrollment expires at ${enrollment.expiresAt.toISOString()}. Invalidated sessions: ${result.sessions}.\n`,
    );
    process.stdout.write(`ONE-TIME EMERGENCY ENROLLMENT TOKEN: ${enrollment.token}\n`);
  } finally {
    rl.close();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Emergency recovery failed.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
