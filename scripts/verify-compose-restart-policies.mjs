import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LONG_RUNNING = ["app", "scheduler", "backup-worker", "postgres", "valkey", "caddy"];
const RESTART_POLICIES = new Set(["unless-stopped", "always"]);

/** Verify the effective compose model without starting or restarting anything. */
export function verifyRestartPolicies(compose) {
  const services = compose?.services ?? {};
  const expected = services.minio ? [...LONG_RUNNING, "minio"] : LONG_RUNNING;
  for (const name of expected) {
    if (!RESTART_POLICIES.has(services[name]?.restart)) {
      throw new Error(`${name}: missing long-running restart policy`);
    }
  }
  if (services.migrate?.restart !== undefined && services.migrate.restart !== "no") {
    throw new Error("migrate must remain one-shot with restart=no");
  }
  // Scheduler has a durable heartbeat-style health contract exposed by the app.
  // Backup-worker recovery is represented by durable BackupOperation state and
  // restart policy; it has no HTTP health contract to probe from Compose.
  for (const name of ["scheduler"]) {
    if (!services[name]?.healthcheck) throw new Error(`${name}: missing healthcheck for recovery verification`);
  }
  if (!services.app?.healthcheck) throw new Error("app: missing healthcheck for dependency-gated recovery");
  return { ok: true, longRunning: expected, migration: services.migrate?.restart };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = execFileSync("docker", ["compose", "--env-file", ".env.production.example", "-f", "docker-compose.production.yml", "config", "--format", "json"], { encoding: "utf8" });
  console.log(JSON.stringify(verifyRestartPolicies(JSON.parse(raw))));
}
