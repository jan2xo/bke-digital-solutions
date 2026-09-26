import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = ".env.certification";
const base = [
  "compose",
  "-p",
  "bke-v3-disposable",
  "--env-file",
  ENV_FILE,
  "-f",
  "docker-compose.production.yml",
  "-f",
  "docker-compose.disposable.yml",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function materialize() {
  run(process.execPath, ["scripts/v3-disposable-env.mjs"]);
}

function compose(args) {
  run("docker", [...base, ...args]);
}

const action = process.argv[2] ?? "status";

switch (action) {
  case "prepare":
    materialize();
    break;
  case "config":
    materialize();
    compose(["config", "--quiet"]);
    console.info("Disposable Compose configuration is valid.");
    break;
  case "up":
    materialize();
    compose(["config", "--quiet"]);
    compose(["up", "-d", "postgres", "valkey", "minio", "minio-init"]);
    compose(["--profile", "operations", "run", "--rm", "--build", "migrate"]);
    compose(["--profile", "operations", "run", "--rm", "--build", "seed"]);
    compose(["up", "-d", "--build", "--force-recreate", "app", "scheduler", "backup-worker", "caddy"]);
    run(process.execPath, ["scripts/v3-disposable-doctor.mjs"]);
    break;
  case "refresh":
    materialize();
    compose(["config", "--quiet"]);
    compose(["--profile", "operations", "run", "--rm", "--build", "migrate"]);
    compose(["up", "-d", "--build", "--force-recreate", "app", "scheduler", "backup-worker", "caddy"]);
    run(process.execPath, ["scripts/v3-disposable-doctor.mjs"]);
    break;
  case "utm-fixture":
    materialize();
    compose(["config", "--quiet"]);
    compose([
      "--profile",
      "operations",
      "run",
      "--rm",
      "--build",
      "seed",
      "npm",
      "run",
      "disposable:utm-fixture",
    ]);
    break;
  case "doctor":
    materialize();
    run(process.execPath, ["scripts/v3-disposable-doctor.mjs"]);
    break;
  case "smoke":
    materialize();
    compose(["--profile", "operations", "run", "--rm", "--build", "smoke"]);
    break;
  case "status":
    materialize();
    compose(["ps"]);
    break;
  case "logs":
    materialize();
    compose(["logs", "--tail", process.env.BKE_LOG_TAIL ?? "150", ...process.argv.slice(3)]);
    break;
  case "down":
    materialize();
    compose(["down"]);
    break;
  case "reset":
    materialize();
    compose(["down", "-v", "--remove-orphans"]);
    console.info("Disposable V3 containers and volumes removed. Local secret bundle was preserved.");
    break;
  default:
    console.error(`Unknown disposable action: ${action}`);
    process.exit(2);
}
