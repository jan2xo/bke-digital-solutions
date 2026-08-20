import { execFileSync } from "node:child_process";

const envFile = process.argv[2] ?? ".env.vps";
const compose = "docker-compose.production.yml";
const run = (command, args) => execFileSync(command, args, { stdio: "inherit", env: { ...process.env, DEPLOYMENT_ENV_FILE: envFile, DEPLOYMENT_COMPOSE_FILE: compose } });

console.log(`Validating production topology with ${envFile}; no services are changed.`);
run("docker", ["compose", "--env-file", envFile, "-f", compose, "config", "--quiet"]);
run("node", ["scripts/verify-deployment-manifest.mjs"]);
run("node", ["scripts/verify-compose-restart-policies.mjs"]);
console.log("Production configuration, topology, and restart policy checks passed.");
