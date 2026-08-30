import { Client } from "pg";
import type {
  IdentityLifecycleState,
  IdentityPrincipal,
  IdentityRole,
} from "../../contracts/identity.contract";
import type { IdentityRepository } from "../../logic/identity-repository";

type IdentityRow = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
  role: IdentityRole;
  suspendedAt: Date | null;
  lifecycleState: IdentityLifecycleState;
};

const principalProjection = `
  SELECT
    "id",
    "email",
    "name",
    "emailVerified",
    "role",
    "suspendedAt",
    "lifecycleState"
  FROM "User"
`;

async function findOne(
  connectionString: string,
  predicate: string,
  value: string,
): Promise<IdentityPrincipal | null> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<IdentityRow>(
      `${principalProjection} WHERE ${predicate} = $1 LIMIT 1`,
      [value],
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

export function createPostgresIdentityRepository(
  connectionString: string,
): IdentityRepository {
  const normalizedConnectionString = connectionString.trim();
  if (!normalizedConnectionString) {
    throw new Error("Identity PostgreSQL connection string is required.");
  }

  return Object.freeze({
    findById(userId: string) {
      return findOne(normalizedConnectionString, '"id"', userId);
    },
    findByEmail(email: string) {
      return findOne(normalizedConnectionString, '"email"', email);
    },
  });
}
