import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { createEmergencyEnrollmentToken, verifyOwnerRecoverySecret } from "../lib/emergency-mfa";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const protectedEnvironment = ["staging", "production"].includes(process.env.DEPLOYMENT_ENV ?? "development");
const ask = async (rl: ReturnType<typeof createInterface>, key: string, prompt: string) => (process.env[key] ?? await rl.question(prompt)).trim();

async function main() {
  if (protectedEnvironment && process.env.ADMIN_RECOVERY_ACK !== "I_UNDERSTAND_THIS_RESETS_ADMINISTRATOR_MFA") throw new Error("Set ADMIN_RECOVERY_ACK to the documented acknowledgement.");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const ownerSecret = await ask(rl, "ADMIN_RECOVERY_OWNER_SECRET", "Owner recovery secret: ");
    if (!verifyOwnerRecoverySecret(ownerSecret)) throw new Error("Invalid owner recovery secret.");
    const email = (await ask(rl, "ADMIN_RECOVERY_EMAIL", "Existing administrator email: ")).toLowerCase();
    const confirmation = await ask(rl, "ADMIN_RECOVERY_CONFIRM", `Type ${email} to confirm recovery: `);
    const reason = await ask(rl, "ADMIN_RECOVERY_REASON", "Mandatory recovery reason: ");
    const operator = await ask(rl, "ADMIN_RECOVERY_OPERATOR_ID", "Deployment operator identity: ");
    if (!email || confirmation.toLowerCase() !== email || !reason || !operator) throw new Error("Target, typed confirmation, reason, and operator identity are required.");
    const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, lifecycleState: true, credential: { select: { userId: true } } } });
    if (!user || user.role !== "ADMIN" || user.lifecycleState !== "ACTIVE" || !user.credential) throw new Error("An active existing administrator is required.");
    const enrollment = createEmergencyEnrollmentToken();
    const result = await db.$transaction(async (tx) => {
      await tx.emergencyMfaEnrollmentAuthorization.updateMany({ where: { userId: user.id, consumedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      const [mfa, recovery, challenges, sessions] = await Promise.all([
        tx.administratorMfaMethod.deleteMany({ where: { userId: user.id } }),
        tx.administratorRecoveryCode.deleteMany({ where: { userId: user.id } }),
        tx.mfaChallenge.deleteMany({ where: { userId: user.id } }),
        tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: "ADMIN_EMERGENCY_MFA_RECOVERY" } }),
      ]);
      await tx.auditLog.create({ data: { action: "ADMIN_EMERGENCY_MFA_RECOVERY", targetType: "User", targetId: user.id, metadata: { targetEmail: user.email, reason: reason.slice(0, 500), recoveryMethod: "DEPLOYMENT_OPERATOR", operatorId: operator.slice(0, 160), deploymentEnvironment: process.env.DEPLOYMENT_ENV ?? "development", invalidated: { mfaMethods: mfa.count, recoveryCodes: recovery.count, challenges: challenges.count, sessions: sessions.count } } } });
      await tx.emergencyMfaEnrollmentAuthorization.create({ data: { userId: user.id, tokenHash: enrollment.tokenHash, expiresAt: enrollment.expiresAt, recoveryReason: reason.slice(0, 500), operatorIdentity: operator.slice(0, 160), ownerKeyVersion: Number(process.env.ADMIN_OWNER_RECOVERY_KEY_VERSION ?? 1), deploymentEnvironment: process.env.DEPLOYMENT_ENV ?? "development" } });
      return { mfa: mfa.count, recovery: recovery.count, challenges: challenges.count, sessions: sessions.count };
    });
    process.stdout.write(`Emergency MFA recovery completed for ${user.email}. Enrollment expires at ${enrollment.expiresAt.toISOString()}. Invalidated sessions: ${result.sessions}.\n`);
    process.stdout.write(`ONE-TIME EMERGENCY ENROLLMENT TOKEN: ${enrollment.token}\n`);
  } finally { rl.close(); }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Emergency recovery failed."); process.exitCode = 1; }).finally(() => db.$disconnect());
