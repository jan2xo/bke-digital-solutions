import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const protectedEnvironment = ["staging", "production"].includes(
  process.env.DEPLOYMENT_ENV ?? "development",
);

async function main() {
  if (
    protectedEnvironment &&
    process.env.ADMIN_BOOTSTRAP_ACK !==
      "I_UNDERSTAND_THIS_CREATES_A_PRIVILEGED_ACCOUNT"
  ) {
    throw new Error("Set ADMIN_BOOTSTRAP_ACK to the documented acknowledgement.");
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const userId = (process.env.ADMIN_USER_ID ?? await rl.question("Google-bound BKE user ID: ")).trim();
    const confirmation = (process.env.ADMIN_BOOTSTRAP_CONFIRM ?? await rl.question(`Type ${userId} to confirm administrator bootstrap: `)).trim();
    const reason = (process.env.ADMIN_BOOTSTRAP_REASON ?? await rl.question("Mandatory authorization reason: ")).trim();
    const operator = (process.env.ADMIN_BOOTSTRAP_OPERATOR_ID ?? await rl.question("Deployment operator identity: ")).trim();

    if (!userId || confirmation !== userId || !reason || !operator) {
      throw new Error("Target ID, exact confirmation, reason, and operator identity are required.");
    }

    const now = new Date();
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
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
      if (otherAdministrators > 0 && process.env.ADMIN_ALLOW_ADDITIONAL !== "true") {
        throw new Error(
          "Another administrator exists. Set ADMIN_ALLOW_ADDITIONAL=true only after explicit authorization.",
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
            reason: reason.slice(0, 500),
            operatorId: operator.slice(0, 160),
            deploymentEnvironment: process.env.DEPLOYMENT_ENV ?? "development",
            revokedSessions: revoked.count,
            mfaEnrollmentRequired: true,
          },
        },
      });
      return { userId: user.id, revokedSessions: revoked.count };
    }, { isolationLevel: "Serializable" });

    console.info(
      `Google-bound administrator ${result.userId} was authorized; ${result.revokedSessions} existing session(s) revoked. Sign in with Google and complete fresh BKE MFA enrollment.`,
    );
  } finally {
    rl.close();
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Administrator bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
