import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const composeFile = process.env.DEPLOYMENT_COMPOSE_FILE ?? "docker-compose.production.yml";
const envFile = process.env.DEPLOYMENT_ENV_FILE ?? ".env.production.example";

if (!existsSync(composeFile)) throw new Error(`Missing deployment compose file: ${composeFile}`);
if (!existsSync(envFile)) throw new Error(`Missing deployment environment template: ${envFile}`);
if (!existsSync("Caddyfile")) throw new Error("Missing HTTPS proxy configuration: Caddyfile");

const compose = JSON.parse(execFileSync("docker", ["compose", "--env-file", envFile, "-f", composeFile, "config", "--format", "json"], { encoding: "utf8" }));
const services = compose.services ?? {};
const required = ["app", "scheduler", "backup-worker", "postgres", "valkey", "minio", "caddy"];
for (const name of required) {
  if (!services[name]) throw new Error(`Deployment topology is incomplete: missing ${name}`);
  if (!["unless-stopped", "always"].includes(services[name].restart)) throw new Error(`${name} must restart after host/process failure`);
}
if (services.migrate && services.migrate.restart !== "no") throw new Error("migrate must be a one-shot service with restart=no");
if (!services.caddy.ports?.some((port) => String(port.published ?? port).split(":")[0] === "443")) throw new Error("HTTPS port 443 is not exposed by caddy");
if (!services.app.healthcheck || !services.caddy.depends_on?.app) throw new Error("Proxy must depend on a healthy application");
if (!readFileSync("Dockerfile", "utf8").includes("HEALTHCHECK")) throw new Error("Application image must declare a healthcheck");

console.log(JSON.stringify({ ok: true, composeFile, services: required, checks: ["restart-policies", "one-shot-migrations", "https-proxy", "healthchecks"] }));
