import { spawnSync } from "node:child_process";

const action = process.argv[2] ?? "status";
const base = ["compose", "-p", "bke-certification", "--profile", "self-hosted-storage", "--env-file", ".env.certification", "-f", "docker-compose.production.yml", "-f", "docker-compose.certification.yml"];
const actions = {
  config: ["config", "--quiet"],
  up: ["up", "-d", "postgres", "valkey", "minio", "minio-init", "app", "caddy"],
  refresh: ["up", "-d", "--build", "--force-recreate", "app", "caddy"],
  down: ["down"],
  status: ["ps"],
  logs: ["logs", "--tail", "100", "app", "caddy"],
  migrate: ["--profile", "operations", "run", "--rm", "migrate"],
  seed: ["--profile", "operations", "run", "--rm", "seed"],
  admin: ["--profile", "operations", "run", "--rm", "seed", "npm", "run", "admin:create"],
  smoke: ["--profile", "operations", "run", "--rm", "smoke"],
  "queue-email": ["--profile", "operations", "run", "--rm", "seed", "npm", "run", "certification:queue-email"],
};

if (!(action in actions)) {
  console.error(`Unknown certification action: ${action}`);
  process.exit(2);
}
const result = spawnSync("docker", [...base, ...actions[action]], { stdio: "inherit" });
process.exit(result.status ?? 1);
