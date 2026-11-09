import "server-only";
import { currentOperationDatabaseUrl, operationResource } from "@/platform/host/operation-scope";
import { parseEnvironment, type ServerEnvironment } from "@/platform/host/config/environment";

const workersRuntime = process.env.BKE_RUNTIME === "workers";
function workersEnvironment(): ServerEnvironment {
  const databaseUrl = currentOperationDatabaseUrl();
  if (!databaseUrl) throw new Error("WORKER_OPERATION_SCOPE_REQUIRED");
  return operationResource("server-environment", () => parseEnvironment({ ...process.env, DATABASE_URL: databaseUrl }));
}
const nodeEnvironment = workersRuntime ? undefined : parseEnvironment(process.env);
const nodeEnv = nodeEnvironment ? new Proxy(nodeEnvironment, {
  get(target, property, receiver) {
    if (property === "DATABASE_URL") return currentOperationDatabaseUrl() ?? target.DATABASE_URL;
    return Reflect.get(target, property, receiver);
  },
}) : undefined;
const workersEnv = new Proxy({} as ServerEnvironment, {
  get(_target, property) { return Reflect.get(workersEnvironment(), property); },
  has(_target, property) { return Reflect.has(workersEnvironment(), property); },
  ownKeys() { return Reflect.ownKeys(workersEnvironment()); },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(workersEnvironment(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
});
export const env = workersRuntime ? workersEnv : nodeEnv!;
export function getRuntimeEnvironment(): ServerEnvironment {
  if (workersRuntime) return workersEnvironment();
  return parseEnvironment({ ...process.env, DATABASE_URL: currentOperationDatabaseUrl() ?? process.env.DATABASE_URL });
}
