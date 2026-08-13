import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const composeFile = process.env.DEPLOYMENT_COMPOSE_FILE ?? "docker-compose.production.yml";
const envFile = process.env.DEPLOYMENT_ENV_FILE ?? ".env.production.example";

export function verifyTopology(compose, caddyfile, dockerfile) {
  const services = compose.services ?? {};
  const required = ["app", "scheduler", "backup-worker", "postgres", "valkey", "minio", "caddy"];
  for (const name of required) {
    if (!services[name]) throw new Error(`Deployment topology is incomplete: missing ${name}`);
    if (!["unless-stopped", "always"].includes(services[name].restart)) throw new Error(`${name} must restart after host/process failure`);
  }
  if (services.migrate && services.migrate.restart !== "no") throw new Error("migrate must be a one-shot service with restart=no");
  const caddy = services.caddy;
  const app = services.app;
  if (!caddy.ports?.some((port) => String(port.published ?? port).split(":")[0] === "443")) throw new Error("HTTPS port 443 is not exposed by caddy");
  if (!app.healthcheck) throw new Error("Application image must declare a healthcheck in Compose");
  if (caddy.depends_on?.app?.condition !== "service_healthy") throw new Error("Proxy must depend on a healthy application");
  const appNetworks = new Set(Array.isArray(app.networks) ? app.networks : Object.keys(app.networks ?? {}));
  const caddyNetworks = new Set(Array.isArray(caddy.networks) ? caddy.networks : Object.keys(caddy.networks ?? {}));
  if (![...appNetworks].some((network) => caddyNetworks.has(network))) throw new Error("Proxy and application must share a network");
  if (!caddy.volumes?.some((volume) => String(volume).split(":").slice(1).includes("/etc/caddy/Caddyfile"))) throw new Error("Caddyfile must be mounted into the proxy container");
  if (!/reverse_proxy\s+app:3000\b/.test(caddyfile)) throw new Error("Caddy must reverse proxy to app:3000");
  if (!/\$\{APP_DOMAIN\}/.test(caddyfile)) throw new Error("Caddy must configure the deployment application domain");
  if (!dockerfile.includes("HEALTHCHECK")) throw new Error("Application image must declare a healthcheck");
  return { required, checks: ["restart-policies", "one-shot-migrations", "https-proxy", "healthy-proxy-upstream", "shared-proxy-network", "healthchecks"] };
}

export function loadAndVerify({ composePath = composeFile, environmentPath = envFile, caddyPath = "Caddyfile", dockerfilePath = "Dockerfile" } = {}) {
  if (!existsSync(composePath)) throw new Error(`Missing deployment compose file: ${composePath}`);
  if (!existsSync(environmentPath)) throw new Error(`Missing deployment environment template: ${environmentPath}`);
  if (!existsSync(caddyPath)) throw new Error("Missing HTTPS proxy configuration: Caddyfile");
  const compose = JSON.parse(execFileSync("docker", ["compose", "--env-file", environmentPath, "-f", composePath, "config", "--format", "json"], { encoding: "utf8" }));
  return verifyTopology(compose, readFileSync(caddyPath, "utf8"), readFileSync(dockerfilePath, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify({ ok: true, composeFile, ...loadAndVerify() }));
