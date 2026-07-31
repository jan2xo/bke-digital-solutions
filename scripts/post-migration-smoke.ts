import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { parseEnvironment } from "../lib/config/environment";

const environment = parseEnvironment(process.env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: environment.DATABASE_URL }) });
try {
  await db.$queryRaw`SELECT 1`;
  const migrations = await db.$queryRaw<Array<{ failed: bigint }>>`SELECT COUNT(*)::bigint AS failed FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`;
  if (Number(migrations[0]?.failed ?? 0) !== 0) throw new Error("Migration history contains incomplete or rolled-back entries");
  console.info("Post-migration database smoke check passed.");
} finally {
  await db.$disconnect();
}
