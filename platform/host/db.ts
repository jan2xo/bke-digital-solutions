import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/platform/persistence/generated/prisma/client";

// Database construction owns only its connection configuration. Deployment
// validation and each business provider retain their own complete validation.
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("Missing database configuration: DATABASE_URL");
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
