import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../platform/persistence/generated/prisma/client";
import { parseEnvironment } from "../platform/host/config/environment";

const environment = parseEnvironment(process.env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }) });
try {
  await db.$queryRaw`SELECT 1`;
  const migrations = await db.$queryRaw<Array<{ failed: bigint }>>`SELECT COUNT(*)::bigint AS failed FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`;
  if (Number(migrations[0]?.failed ?? 0) !== 0) throw new Error("Migration history contains incomplete or rolled-back entries");
  // Read-only production-safe check: a green migration history alone did not
  // catch the legacy three-type PurchasePlan check after SEMI_ANNUAL was added.
  const planTerms = await db.$queryRaw<Array<{ definition: string }>>`
    SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'PurchasePlan'
      AND c.conname = 'PurchasePlan_terms_check'
      AND c.contype = 'c'
  `;
  if (
    planTerms.length !== 1 ||
    !["PERPETUAL", "MONTHLY", "SEMI_ANNUAL", "ANNUAL"].every(
      (type) => planTerms[0].definition.includes(type),
    )
  ) {
    throw new Error("PurchasePlan_terms_check is missing the SEMI_ANNUAL migration repair");
  }

  console.info("Post-migration database smoke check passed.");
} finally {
  await db.$disconnect();
}
