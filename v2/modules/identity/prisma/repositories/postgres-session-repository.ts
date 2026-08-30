import { Client } from "pg";
import type {
  IdentityIssuedSession,
  IdentitySessionAssuranceLevel,
  IdentitySessionAuthenticationMethod,
} from "../../contracts/session.contract";
import type {
  IdentitySessionPersistenceInput,
  IdentitySessionRepository,
} from "../../logic/session-repository";

type PrincipalStateRow = {
  role: "CUSTOMER" | "ADMIN";
  suspendedAt: Date | null;
  lifecycleState: string;
};

type SessionRow = {
  id: string;
  userId: string;
  expiresAt: Date;
  lastAuthenticatedAt: Date;
  mfaVerifiedAt: Date | null;
  recentAuthenticatedAt: Date | null;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  authenticationMethod: IdentitySessionAuthenticationMethod;
  assuranceLevel: IdentitySessionAssuranceLevel;
  createdAt: Date;
};

function toIssuedSession(row: SessionRow): IdentityIssuedSession {
  return {
    id: row.id,
    userId: row.userId,
    expiresAt: row.expiresAt,
    lastAuthenticatedAt: row.lastAuthenticatedAt,
    mfaVerifiedAt: row.mfaVerifiedAt,
    recentAuthenticatedAt: row.recentAuthenticatedAt,
    lastSeenAt: row.lastSeenAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    authenticationMethod: row.authenticationMethod,
    assuranceLevel: row.assuranceLevel,
    createdAt: row.createdAt,
  };
}

export function createPostgresIdentitySessionRepository(
  connectionString: string,
): IdentitySessionRepository {
  const normalizedConnectionString = connectionString.trim();
  if (!normalizedConnectionString) {
    throw new Error("Identity PostgreSQL connection string is required.");
  }

  return Object.freeze({
    async issueSession(input: IdentitySessionPersistenceInput) {
      const client = new Client({ connectionString: normalizedConnectionString });
      await client.connect();

      try {
        await client.query("BEGIN");

        const principal = await client.query<PrincipalStateRow>(
          `SELECT "role", "suspendedAt", "lifecycleState"
             FROM "User"
            WHERE "id" = $1
            LIMIT 1`,
          [input.userId],
        );
        const state = principal.rows[0];

        if (!state) {
          await client.query("ROLLBACK");
          return { status: "PRINCIPAL_NOT_FOUND" as const };
        }

        // Preserve V1 issuance semantics: customer sessions are refused unless
        // the account is active. Administrator lifecycle enforcement remains
        // part of session validation/MFA policy rather than this issuance gate.
        if (
          state.role !== "ADMIN" &&
          (state.suspendedAt !== null || state.lifecycleState !== "ACTIVE")
        ) {
          await client.query("ROLLBACK");
          return { status: "ACCOUNT_NOT_ACTIVE" as const };
        }

        const result = await client.query<SessionRow>(
          `INSERT INTO "Session" (
             "id",
             "tokenHash",
             "userId",
             "expiresAt",
             "lastAuthenticatedAt",
             "mfaVerifiedAt",
             "recentAuthenticatedAt",
             "lastSeenAt",
             "absoluteExpiresAt",
             "userAgentSummary",
             "networkHint",
             "authenticationMethod",
             "assuranceLevel"
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12::"SessionAuthenticationMethod",
             $13::"SessionAssuranceLevel"
           )
           RETURNING
             "id",
             "userId",
             "expiresAt",
             "lastAuthenticatedAt",
             "mfaVerifiedAt",
             "recentAuthenticatedAt",
             "lastSeenAt",
             "absoluteExpiresAt",
             "authenticationMethod",
             "assuranceLevel",
             "createdAt"`,
          [
            input.id,
            input.tokenHash,
            input.userId,
            input.expiresAt,
            input.lastAuthenticatedAt,
            input.mfaVerifiedAt,
            input.recentAuthenticatedAt,
            input.lastSeenAt,
            input.absoluteExpiresAt,
            input.userAgentSummary,
            input.networkHint,
            input.authenticationMethod,
            input.assuranceLevel,
          ],
        );

        await client.query("COMMIT");
        const session = result.rows[0];
        if (!session) {
          throw new Error("Identity session insert returned no row.");
        }
        return { status: "CREATED" as const, session: toIssuedSession(session) };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await client.end();
      }
    },
  });
}
