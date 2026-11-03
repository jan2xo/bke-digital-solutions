import "dotenv/config";

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";
import { bootstrapGoogleAdministrator } from "./google-admin-bootstrap";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const deploymentEnvironment = process.env.DEPLOYMENT_ENV ?? "development";
const protectedEnvironment = ["staging", "production"].includes(deploymentEnvironment);

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
    const operatorId = (process.env.ADMIN_BOOTSTRAP_OPERATOR_ID ?? await rl.question("Deployment operator identity: ")).trim();
    if (!userId || confirmation !== userId) {
      throw new Error("Exact target user-ID confirmation is required.");
    }

    const result = await bootstrapGoogleAdministrator(db, {
      userId,
      reason,
      operatorId,
      deploymentEnvironment,
      allowAdditionalAdministrator: process.env.ADMIN_ALLOW_ADDITIONAL === "true",
    });
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
