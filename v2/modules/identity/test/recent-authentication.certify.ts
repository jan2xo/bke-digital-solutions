import argon2 from "argon2";
import { Client } from "pg";
import { createIdentityRecentAuthChallengeIssuanceCapability } from "../logic/recent-auth-challenge-issuance";
import { createIdentityRecentAuthenticationCapability } from "../logic/recent-authentication";
import { createArgon2PasswordVerifier } from "../logic/providers/argon2-password-verifier";
import { createHmacEmailMfaChallengeMaterialProvider } from "../logic/providers/hmac-email-mfa-challenge-material-provider";
import { createHmacEmailMfaProofProvider } from "../logic/providers/hmac-email-mfa-proof-provider";
import { createHmacSessionTokenProvider } from "../logic/providers/hmac-session-token-provider";
import { createIdentitySessionIssuanceCapability } from "../logic/session-issuance";
import { createPostgresIdentityRecentAuthChallengeRepository } from "../prisma/repositories/postgres-recent-auth-challenge-repository";
import { createPostgresIdentityRecentAuthenticationRepository } from "../prisma/repositories/postgres-recent-authentication-repository";
import { createPostgresIdentitySessionRepository } from "../prisma/repositories/postgres-session-repository";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DATABASE_URL is required for recent-authentication certification.");
}

const now = new Date("2026-08-31T09:00:00.000Z");
const sessionIssuedAt = new Date(now.getTime() - 30 * 60_000);
const password = "RecentAuthPassword123";
const sessionSecret = "identity-recent-auth-cert-session-secret";
const mfaEncryptionKey = "identity-recent-auth-cert-encryption-key";
const passwordHash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

const proofProvider = createHmacEmailMfaProofProvider(
  sessionSecret,
  mfaEncryptionKey,
);
const challengeMaterialProvider = createHmacEmailMfaChallengeMaterialProvider(
  sessionSecret,
  mfaEncryptionKey,
);
const repository = createPostgresIdentityRecentAuthenticationRepository(
  connectionString,
);
const capability = createIdentityRecentAuthenticationCapability(
  repository,
  createArgon2PasswordVerifier(),
  proofProvider,
  () => now,
);
const challengeIssuance = createIdentityRecentAuthChallengeIssuanceCapability(
  createPostgresIdentityRecentAuthChallengeRepository(connectionString),
  challengeMaterialProvider,
  () => now,
);
const issueSession = createIdentitySessionIssuanceCapability(
  createPostgresIdentitySessionRepository(connectionString),
  createHmacSessionTokenProvider(sessionSecret),
  () => sessionIssuedAt,
);
const client = new Client({ connectionString });
await client.connect();

async function createUser(
  id: string,
  role: "CUSTOMER" | "ADMIN",
  withMfa = false,
) {
  await client.query(
    `INSERT INTO "User" ("id", "email", "name", "role", "updatedAt", "lifecycleState")
     VALUES ($1, $2, $3, $4::"IdentityRole", $5, 'ACTIVE')`,
    [id, `${id}@example.com`, id, role, sessionIssuedAt],
  );
  await client.query(
    `INSERT INTO "PasswordCredential" ("userId", "passwordHash") VALUES ($1, $2)`,
    [id, passwordHash],
  );
  if (withMfa) {
    await client.query(
      `INSERT INTO "AdministratorMfaMethod"
         ("id", "userId", "enabledAt", "verifiedAt", "updatedAt")
       VALUES ($1, $2, $3, $3, $3)`,
      [`${id}-mfa`, id, sessionIssuedAt],
    );
  }
}

async function createSession(
  userId: string,
  method: "PASSWORD" | "PASSWORD_EMAIL_OTP",
) {
  const issued = await issueSession.issue({ userId, authenticationMethod: method });
  if (issued.status !== "ISSUED") {
    throw new Error(`Could not issue recent-auth certification session: ${JSON.stringify(issued)}`);
  }
  await client.query(
    `UPDATE "Session"
        SET "recentAuthenticatedAt" = NULL,
            "assuranceLevel" = $2::"SessionAssuranceLevel"
      WHERE "id" = $1`,
    [issued.session.id, method === "PASSWORD" ? "BASIC" : "MFA_VERIFIED"],
  );
  return issued.session.id;
}

async function sessionState(sessionId: string) {
  const result = await client.query<{
    recentAuthenticatedAt: Date | null;
    assuranceLevel: string;
    authenticationMethod: string;
    revokedAt: Date | null;
  }>(
    `SELECT "recentAuthenticatedAt", "assuranceLevel", "authenticationMethod", "revokedAt"
       FROM "Session" WHERE "id" = $1`,
    [sessionId],
  );
  return result.rows[0];
}

try {
  // Customer: password alone upgrades the same session in place.
  await createUser("recent-customer", "CUSTOMER");
  const customerSession = await createSession("recent-customer", "PASSWORD");
  const customer = await capability.authenticate({
    sessionId: customerSession,
    userId: "recent-customer",
    password,
  });
  if (
    customer.status !== "AUTHENTICATED" ||
    customer.authenticationMethod !== "PASSWORD" ||
    customer.recentAuthenticatedAt.getTime() !== now.getTime()
  ) {
    throw new Error(`Customer recent auth failed: ${JSON.stringify(customer)}`);
  }
  const customerState = await sessionState(customerSession);
  if (
    customerState?.recentAuthenticatedAt?.getTime() !== now.getTime() ||
    customerState.assuranceLevel !== "RECENTLY_AUTHENTICATED" ||
    customerState.authenticationMethod !== "PASSWORD"
  ) {
    throw new Error(`Customer session was not upgraded in place: ${JSON.stringify(customerState)}`);
  }

  // Wrong password must not mutate the session.
  await createUser("recent-wrong-password", "CUSTOMER");
  const wrongPasswordSession = await createSession("recent-wrong-password", "PASSWORD");
  const wrongPassword = await capability.authenticate({
    sessionId: wrongPasswordSession,
    userId: "recent-wrong-password",
    password: "WrongPassword123",
  });
  if (wrongPassword.status !== "INVALID" || wrongPassword.code !== "INVALID_CREDENTIALS") {
    throw new Error(`Wrong password did not fail closed: ${JSON.stringify(wrongPassword)}`);
  }
  const wrongPasswordState = await sessionState(wrongPasswordSession);
  if (wrongPasswordState?.recentAuthenticatedAt !== null) {
    throw new Error("Wrong password mutated recentAuthenticatedAt.");
  }

  // Admin: password + RECENT_AUTH email OTP consume proof and upgrade the same session atomically.
  await createUser("recent-admin", "ADMIN", true);
  const adminSession = await createSession("recent-admin", "PASSWORD_EMAIL_OTP");
  const adminChallenge = await challengeIssuance.issue({ userId: "recent-admin" });
  if (adminChallenge.status !== "ISSUED") {
    throw new Error(`Admin recent challenge failed: ${JSON.stringify(adminChallenge)}`);
  }
  const admin = await capability.authenticate({
    sessionId: adminSession,
    userId: "recent-admin",
    password,
    challengeToken: adminChallenge.challenge.challengeToken,
    code: adminChallenge.challenge.delivery.code,
  });
  if (
    admin.status !== "AUTHENTICATED" ||
    admin.authenticationMethod !== "PASSWORD_EMAIL_OTP"
  ) {
    throw new Error(`Admin recent auth failed: ${JSON.stringify(admin)}`);
  }
  const adminState = await sessionState(adminSession);
  if (
    adminState?.recentAuthenticatedAt?.getTime() !== now.getTime() ||
    adminState.assuranceLevel !== "RECENTLY_AUTHENTICATED" ||
    adminState.authenticationMethod !== "PASSWORD_EMAIL_OTP"
  ) {
    throw new Error(`Admin session upgrade is invalid: ${JSON.stringify(adminState)}`);
  }
  const adminChallengeState = await client.query<{ consumedAt: Date | null }>(
    `SELECT "consumedAt" FROM "MfaChallenge"
      WHERE "userId" = 'recent-admin' AND "purpose" = 'RECENT_AUTH'`,
  );
  if (adminChallengeState.rows[0]?.consumedAt?.getTime() !== now.getTime()) {
    throw new Error("Admin recent-auth challenge was not consumed.");
  }

  // Wrong OTP burns one attempt but leaves session assurance untouched.
  await createUser("recent-wrong-code", "ADMIN", true);
  const wrongCodeSession = await createSession("recent-wrong-code", "PASSWORD_EMAIL_OTP");
  const wrongCodeChallenge = await challengeIssuance.issue({ userId: "recent-wrong-code" });
  if (wrongCodeChallenge.status !== "ISSUED") throw new Error("Wrong-code challenge did not issue.");
  const wrongCode = await capability.authenticate({
    sessionId: wrongCodeSession,
    userId: "recent-wrong-code",
    password,
    challengeToken: wrongCodeChallenge.challenge.challengeToken,
    code: "000000",
  });
  if (wrongCode.status !== "INVALID" || wrongCode.code !== "INVALID_CODE") {
    throw new Error(`Wrong MFA code did not fail closed: ${JSON.stringify(wrongCode)}`);
  }
  const wrongCodeState = await client.query<{ attemptCount: number; consumedAt: Date | null }>(
    `SELECT "attemptCount", "consumedAt" FROM "MfaChallenge"
      WHERE "userId" = 'recent-wrong-code' AND "purpose" = 'RECENT_AUTH'`,
  );
  if (
    wrongCodeState.rows[0]?.attemptCount !== 1 ||
    wrongCodeState.rows[0]?.consumedAt !== null ||
    (await sessionState(wrongCodeSession))?.recentAuthenticatedAt !== null
  ) {
    throw new Error("Wrong MFA code leaked a recent-auth state mutation.");
  }

  // Recovery proof is one-time and upgrades the existing session without rewriting its original auth method.
  await createUser("recent-recovery", "ADMIN", true);
  const recoverySession = await createSession("recent-recovery", "PASSWORD_EMAIL_OTP");
  const recoveryCode = "ABCDE-FGHIJ";
  await client.query(
    `INSERT INTO "AdministratorRecoveryCode" ("id", "userId", "codeHash") VALUES ($1, $2, $3)`,
    ["recent-recovery-code", "recent-recovery", proofProvider.hashRecoveryCode(recoveryCode)],
  );
  const recoveryChallenge = await challengeIssuance.issue({ userId: "recent-recovery" });
  if (recoveryChallenge.status !== "ISSUED") throw new Error("Recovery challenge did not issue.");
  const recovery = await capability.authenticate({
    sessionId: recoverySession,
    userId: "recent-recovery",
    password,
    challengeToken: recoveryChallenge.challenge.challengeToken,
    code: recoveryCode,
  });
  if (recovery.status !== "AUTHENTICATED" || recovery.authenticationMethod !== "PASSWORD_RECOVERY") {
    throw new Error(`Recovery recent auth failed: ${JSON.stringify(recovery)}`);
  }
  const recoveryUsed = await client.query<{ usedAt: Date | null }>(
    `SELECT "usedAt" FROM "AdministratorRecoveryCode" WHERE "id" = 'recent-recovery-code'`,
  );
  if (
    recoveryUsed.rows[0]?.usedAt?.getTime() !== now.getTime() ||
    (await sessionState(recoverySession))?.authenticationMethod !== "PASSWORD_EMAIL_OTP"
  ) {
    throw new Error("Recovery proof was not one-time or rewrote the session authentication method.");
  }

  // Adversarial rollback: session update happens first, then challenge consumption is forced to fail.
  await createUser("recent-rollback", "ADMIN", true);
  const rollbackSession = await createSession("recent-rollback", "PASSWORD_EMAIL_OTP");
  const rollbackChallenge = await challengeIssuance.issue({ userId: "recent-rollback" });
  if (rollbackChallenge.status !== "ISSUED") throw new Error("Rollback challenge did not issue.");
  await client.query(`
    CREATE OR REPLACE FUNCTION "cert_fail_recent_auth_challenge_consume"()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."consumedAt" IS NOT NULL AND OLD."userId" = 'recent-rollback' THEN
        RAISE EXCEPTION 'forced recent-auth certification failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await client.query(`
    CREATE TRIGGER "cert_fail_recent_auth_challenge_consume_trigger"
    BEFORE UPDATE ON "MfaChallenge"
    FOR EACH ROW EXECUTE FUNCTION "cert_fail_recent_auth_challenge_consume"();
  `);

  const rollbackResult = await capability.authenticate({
    sessionId: rollbackSession,
    userId: "recent-rollback",
    password,
    challengeToken: rollbackChallenge.challenge.challengeToken,
    code: rollbackChallenge.challenge.delivery.code,
  });
  if (
    rollbackResult.status !== "FAILED" ||
    rollbackResult.code !== "PERSISTENCE_UNAVAILABLE"
  ) {
    throw new Error(`Forced recent-auth failure did not fail closed: ${JSON.stringify(rollbackResult)}`);
  }
  const rollbackSessionState = await sessionState(rollbackSession);
  const rollbackChallengeState = await client.query<{ consumedAt: Date | null }>(
    `SELECT "consumedAt" FROM "MfaChallenge"
      WHERE "userId" = 'recent-rollback' AND "purpose" = 'RECENT_AUTH'`,
  );
  if (
    rollbackSessionState?.recentAuthenticatedAt !== null ||
    rollbackSessionState?.assuranceLevel !== "MFA_VERIFIED" ||
    rollbackChallengeState.rows[0]?.consumedAt !== null
  ) {
    throw new Error("Recent-auth transaction leaked partial state across rollback.");
  }

  await client.query(
    `DROP TRIGGER "cert_fail_recent_auth_challenge_consume_trigger" ON "MfaChallenge"`,
  );
  await client.query(`DROP FUNCTION "cert_fail_recent_auth_challenge_consume"()`);

  console.log("Identity recent authentication certification GREEN");
} finally {
  await client.query(
    `DROP TRIGGER IF EXISTS "cert_fail_recent_auth_challenge_consume_trigger" ON "MfaChallenge"`,
  ).catch(() => undefined);
  await client.query(
    `DROP FUNCTION IF EXISTS "cert_fail_recent_auth_challenge_consume"()`,
  ).catch(() => undefined);
  await client.end();
}
