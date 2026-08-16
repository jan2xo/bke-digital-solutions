import { spawnSync } from "node:child_process";

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) throw new Error("A command is required");

const executableArgs = [
  "compose",
  "-p",
  "bke-certification",
  "--profile",
  "self-hosted-storage",
  "--profile",
  "operations",
  "--env-file",
  ".env.certification",
  "-f",
  "docker-compose.production.yml",
  "-f",
  "docker-compose.certification.yml",
  "run",
  "--rm",
  "--build",
  "-e",
  "DATABASE_URL=postgresql://postgres:postgres@postgres:5432/bke_certification",
  "certification-tests",
  command,
  ...args,
];

const result = spawnSync("docker", executableArgs, { stdio: "inherit" });
process.exit(result.status ?? 1);
