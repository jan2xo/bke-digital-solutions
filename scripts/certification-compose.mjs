import { spawnSync } from "node:child_process";

const action = process.argv[2] ?? "status";
const base = ["compose", "-p", "bke-certification", "--profile", "self-hosted-storage", "--env-file", ".env.certification", "-f", "docker-compose.production.yml", "-f", "docker-compose.certification.yml"];
const actions = {
  config: [["config", "--quiet"]],
  up: [
    ["up", "-d", "postgres", "valkey", "minio", "minio-init"],
    ["--profile", "operations", "run", "--rm", "--build", "migrate"],
    ["--profile", "operations", "run", "--rm", "--build", "seed"],
    ["up", "-d", "--build", "--force-recreate", "app", "scheduler", "caddy"],
  ],
  refresh: [
    ["--profile", "operations", "run", "--rm", "--build", "migrate"],
    ["up", "-d", "--build", "--force-recreate", "app", "scheduler", "caddy"],
  ],
  down: ["down"],
  status: ["ps"],
  logs: ["logs", "--tail", "100", "app", "scheduler", "caddy"],
  migrate: [["--profile", "operations", "run", "--rm", "--build", "migrate"]],
  seed: [["--profile", "operations", "run", "--rm", "--build", "seed"]],
  admin: [["--profile", "operations", "run", "--rm", "seed", "npm", "run", "admin:create"]],
  smoke: [["--profile", "operations", "run", "--rm", "smoke"]],
  "queue-email": [["--profile", "operations", "run", "--rm", "seed", "npm", "run", "certification:queue-email"]],
};

if (!(action in actions)) {
  console.error(`Unknown certification action: ${action}`);
  process.exit(2);
}
const steps = Array.isArray(actions[action][0]) ? actions[action] : [actions[action]];
for (const step of steps) {
  const result = spawnSync("docker", [...base, ...step], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
