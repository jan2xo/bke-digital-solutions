import "server-only";
import { currentOperationDatabaseUrl, operationResource } from "@/platform/host/operation-scope";
import { parseEnvironment, type ServerEnvironment } from "@/platform/host/config/environment";

const workersRuntime = process.env.BKE_RUNTIME === "workers";
const nodeEnvironment = workersRuntime ? undefined : parseEnvironment(process.env);

function runtimeEnvironment(): ServerEnvironment {
  if (!workersRuntime) return nodeEnvironment!;
  const databaseUrl = currentOperationDatabaseUrl();
  if (!databaseUrl) throw new Error("WORKER_OPERATION_SCOPE_REQUIRED");
  return operationResource("server-environment", () => parseEnvironment({
    ...process.env,
    DATABASE_URL: databaseUrl,
  }));
}

const proxyTarget = {};
export const env = new Proxy(proxyTarget as ServerEnvironment, {
  get(_target, property) {
    return Reflect.get(runtimeEnvironment(), property);
  },
  has(_target, property) {
    return Reflect.has(runtimeEnvironment(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(runtimeEnvironment());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Object.getOwnPropertyDescriptor(runtimeEnvironment(), property);
    return descriptor ? { ...descriptor, configurable: true } : undefined;
  },
  getPrototypeOf() {
    return Object.prototype;
  },
  set(_target, property, value) {
    return Reflect.set(runtimeEnvironment(), property, value);
  },
  defineProperty(_target, property, descriptor) {
    return Reflect.defineProperty(runtimeEnvironment(), property, descriptor);
  },
  deleteProperty(_target, property) {
    return Reflect.deleteProperty(runtimeEnvironment(), property);
  },
});

/** Resolve deployment configuration at request/operation time. This avoids
 * build-time snapshots for values supplied only by a Workers operation binding. */
export function getRuntimeEnvironment(): ServerEnvironment {
  return runtimeEnvironment();
}
