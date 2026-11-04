import "server-only";
import { currentOperationDatabaseUrl } from "@/platform/host/operation-scope";
import { parseEnvironment } from "@/platform/host/config/environment";

const configured = parseEnvironment(process.env);
export const env = new Proxy(configured, {
  get(target, property, receiver) {
    if (property === "DATABASE_URL") {
      return currentOperationDatabaseUrl() ?? target.DATABASE_URL;
    }
    return Reflect.get(target, property, receiver);
  },
});

/** Resolve deployment configuration at request/operation time. This avoids
 * build-time snapshots for values supplied only when a container starts. */
export function getRuntimeEnvironment() {
  return parseEnvironment({ ...process.env, DATABASE_URL: currentOperationDatabaseUrl() ?? process.env.DATABASE_URL });
}
