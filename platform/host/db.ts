import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/platform/persistence/generated/prisma/client";
import { currentOperationDatabaseUrl, operationResource } from "@/platform/host/operation-scope";

const globals = globalThis as typeof globalThis & { prisma?: PrismaClient };
let nodeClient: PrismaClient | undefined;

function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("Missing database configuration: DATABASE_URL");
  return value;
}

function client(): PrismaClient {
  const connectionString = currentOperationDatabaseUrl();
  if (connectionString) {
    return operationResource(
      "prisma",
      () => new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) }),
      (value) => value.$disconnect(),
    );
  }
  if (process.env.BKE_RUNTIME === "workers") throw new Error("WORKER_OPERATION_SCOPE_REQUIRED");
  nodeClient ??= globals.prisma ?? new PrismaClient({
    adapter: new PrismaPg({ connectionString: requiredDatabaseUrl() }),
  });
  if (process.env.NODE_ENV !== "production") globals.prisma = nodeClient;
  return nodeClient;
}

// Preserve callers, including interactive/array transactions and Prisma promises.
// Resolve delegates against the active operation rather than a global socket.
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
