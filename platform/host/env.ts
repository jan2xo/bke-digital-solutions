import "server-only";
import { parseEnvironment } from "@/platform/host/config/environment";

export const env = parseEnvironment(process.env);

/** Resolve deployment configuration at request/operation time. This avoids
 * build-time snapshots for values supplied only when a container starts. */
export function getRuntimeEnvironment() {
  return parseEnvironment(process.env);
}
