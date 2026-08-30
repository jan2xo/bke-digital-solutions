import { Client } from "pg";
import type {
  IdentityRecentAuthenticationChallengeRecord,
  IdentityRecentAuthenticationContext,
  IdentityRecentAuthenticationRecoveryCodeRecord,
  IdentityRecentAuthenticationRepository,
} from "../../logic/recent-authentication-repository";

type ContextRow = IdentityRecentAuthenticationContext;
type ChallengeRow = IdentityRecentAuthenticationChallengeRecord;
type RecoveryRow = IdentityRecentAuthenticationRecoveryCodeRecord;

const SESSION_IDLE_MS = 60 * 60_000;

export function createPostgresIdentityRecentAuthenticationRepository(
  connectionString: string,
): IdentityRecentAuthenticationRepository {
  const normalizedConnectionString = connectionString.trim();
  if (!normalizedConnectionString) {
    throw new Error("Identity PostgreSQL connection string is required.");
  }

  return Object.freeze({
    async findContext(sessionId: string, userId: string, now: Date) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();
      try {
        const result = await client.query<ContextRow>(
          `SELECT
             s."id" AS "sessionId",
             s."userId",
             u."role" AS "userRole",
             p."passwordHash",
             s."mfaVerifiedAt",
             (m."enabledAt" IS NOT NULL) AS "administratorMfaEnabled"
           FROM "Session" s
           JOIN "User" u ON u."id" = s."userId"
           JOIN "PasswordCredential" p ON p."userId" = s."userId"
           LEFT JOIN "AdministratorMfaMethod" m ON m."userId" = s."userId"
          WHERE s."id" = $1
            AND s."userId" = $2
            AND s."revokedAt" IS NULL
            AND s."expiresAt" > $3
            AND s."absoluteExpiresAt" > $3
            AND s."lastSeenAt" >= $4
            AND u."suspendedAt" IS NULL
          LIMIT 1`,
          [sessionId, userId, now, new Date(now.getTime() - SESSION_IDLE_MS)],
        );
        return result.rows[0] ?? null;
      } finally {
        await client.end();
      }
    },

    async findChallenge(userId: string, tokenHash: string) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();
      try {
        const result = await client.query<ChallengeRow>(
          `SELECT "id", "userId", "purpose", "codeHash", "expiresAt", "consumedAt", "attemptCount"
             FROM "MfaChallenge"
            WHERE "userId" = $1
              AND "tokenHash" = $2
            LIMIT 1`,
          [userId, tokenHash],
        );
        return result.rows[0] ?? null;
      } finally {
        await client.end();
      }
    },

    async findUnusedRecoveryCode(userId: string, codeHash: string) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();
      try {
        const result = await client.query<RecoveryRow>(
          `SELECT "id"
             FROM "AdministratorRecoveryCode"
            WHERE "userId" = $1
              AND "codeHash" = $2
              AND "usedAt" IS NULL
            LIMIT 1`,
          [userId, codeHash],
        );
        return result.rows[0] ?? null;
      } finally {
        await client.end();
      }
    },

    async incrementChallengeAttempt(challengeId: string) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();
      try {
        await client.query(
          `UPDATE "MfaChallenge"
              SET "attemptCount" = "attemptCount" + 1
            WHERE "id" = $1
              AND "consumedAt" IS NULL
              AND "attemptCount" < 5`,
          [challengeId],
        );
      } finally {
        await client.end();
      }
    },

    async upgradeCustomerSession(
      sessionId: string,
      userId: string,
      authenticatedAt: Date,
    ) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();
      try {
        const updated = await client.query(
          `UPDATE "Session" s
              SET "recentAuthenticatedAt" = $3,
                  "assuranceLevel" = 'RECENTLY_AUTHENTICATED'::"SessionAssuranceLevel"
            WHERE s."id" = $1
              AND s."userId" = $2
              AND s."revokedAt" IS NULL
              AND s."expiresAt" > $3
              AND s."absoluteExpiresAt" > $3
              AND s."lastSeenAt" >= $4
              AND EXISTS (
                SELECT 1 FROM "User" u
                 WHERE u."id" = s."userId"
                   AND u."role" = 'CUSTOMER'::"IdentityRole"
                   AND u."suspendedAt" IS NULL
              )`,
          [
            sessionId,
            userId,
            authenticatedAt,
            new Date(authenticatedAt.getTime() - SESSION_IDLE_MS),
          ],
        );
        return (updated.rowCount ?? 0) === 1
          ? ("UPDATED" as const)
          : ("SESSION_REJECTED" as const);
      } finally {
        await client.end();
      }
    },

    async completeAdminRecentAuthentication(input) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();
      try {
        await client.query("BEGIN");

        const session = await client.query(
          `UPDATE "Session" s
              SET "recentAuthenticatedAt" = $3,
                  "assuranceLevel" = 'RECENTLY_AUTHENTICATED'::"SessionAssuranceLevel"
            WHERE s."id" = $1
              AND s."userId" = $2
              AND s."revokedAt" IS NULL
              AND s."expiresAt" > $3
              AND s."absoluteExpiresAt" > $3
              AND s."lastSeenAt" >= $4
              AND s."mfaVerifiedAt" IS NOT NULL
              AND EXISTS (
                SELECT 1
                  FROM "User" u
                  JOIN "AdministratorMfaMethod" m ON m."userId" = u."id"
                 WHERE u."id" = s."userId"
                   AND u."role" = 'ADMIN'::"IdentityRole"
                   AND u."suspendedAt" IS NULL
                   AND m."enabledAt" IS NOT NULL
              )`,
          [
            input.sessionId,
            input.userId,
            input.authenticatedAt,
            new Date(input.authenticatedAt.getTime() - SESSION_IDLE_MS),
          ],
        );
        if ((session.rowCount ?? 0) !== 1) {
          await client.query("ROLLBACK");
          return "SESSION_REJECTED" as const;
        }

        const challenge = await client.query(
          `UPDATE "MfaChallenge"
              SET "consumedAt" = $3
            WHERE "id" = $1
              AND "userId" = $2
              AND "purpose" = 'RECENT_AUTH'::"MfaChallengePurpose"
              AND "consumedAt" IS NULL
              AND "attemptCount" < 5
              AND "expiresAt" > $3`,
          [input.challengeId, input.userId, input.authenticatedAt],
        );
        if ((challenge.rowCount ?? 0) !== 1) {
          await client.query("ROLLBACK");
          return "CHALLENGE_REJECTED" as const;
        }

        if (input.recoveryCodeId) {
          const recovery = await client.query(
            `UPDATE "AdministratorRecoveryCode"
                SET "usedAt" = $3
              WHERE "id" = $1
                AND "userId" = $2
                AND "usedAt" IS NULL`,
            [input.recoveryCodeId, input.userId, input.authenticatedAt],
          );
          if ((recovery.rowCount ?? 0) !== 1) {
            await client.query("ROLLBACK");
            return "RECOVERY_REJECTED" as const;
          }
        }

        await client.query("COMMIT");
        return "UPDATED" as const;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await client.end();
      }
    },
  });
}
