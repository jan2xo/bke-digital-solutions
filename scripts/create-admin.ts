import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import argon2 from "argon2";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
async function main() {
  const protectedEnvironment = ["staging", "production"].includes(process.env.DEPLOYMENT_ENV ?? "development");
  if (protectedEnvironment && process.env.ADMIN_BOOTSTRAP_ACK !== "I_UNDERSTAND_THIS_CREATES_A_PRIVILEGED_ACCOUNT") throw new Error("Set ADMIN_BOOTSTRAP_ACK to the documented acknowledgement for protected environments.");
  const rl = createInterface({ input: stdin, output: stdout });
  const email = (process.env.ADMIN_EMAIL ?? await rl.question("Admin email: ")).trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? await rl.question("Admin name: ")).trim();
  const password = process.env.ADMIN_PASSWORD ?? await rl.question("Admin password (input may be visible): "); rl.close();
  if (password.length < 12) throw new Error("Admin password must be at least 12 characters");
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) throw new Error("Admin password must contain uppercase, lowercase, and numeric characters");
  const existing = await db.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existing && process.env.ADMIN_UPDATE_EXISTING !== "true") throw new Error("This account already exists. Set ADMIN_UPDATE_EXISTING=true only for an authorized password rotation.");
  const existingAdmins = await db.user.count({ where: { role: "ADMIN", email: { not: email } } });
  if (existingAdmins > 0 && process.env.ADMIN_ALLOW_ADDITIONAL !== "true") throw new Error("Another administrator already exists. Set ADMIN_ALLOW_ADDITIONAL=true only after an authorized review.");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const user = await db.user.upsert({ where: { email }, update: { name, role: "ADMIN", emailVerified: new Date(), credential: { upsert: { create: { passwordHash }, update: { passwordHash, changedAt: new Date() } } }, sessions: { deleteMany: {} } }, create: { email, name, role: "ADMIN", emailVerified: new Date(), credential: { create: { passwordHash } }, ownedAccounts: { create: { type: "INDIVIDUAL", displayName: name, billingEmail: email } } } });
  if (!existing || process.env.ADMIN_RESET_MFA === "true") {
    await db.$transaction([db.administratorMfaMethod.deleteMany({ where: { userId: user.id } }), db.administratorRecoveryCode.deleteMany({ where: { userId: user.id } }), db.mfaChallenge.deleteMany({ where: { userId: user.id } })]);
  }
  console.info(existing ? "Administrator credentials updated and sessions revoked." : "Administrator created. Mandatory email-code verification is required before admin access.");
}
main().finally(() => db.$disconnect());
