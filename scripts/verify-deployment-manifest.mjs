import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const composeFile = process.env.DEPLOYMENT_COMPOSE_FILE ?? "docker-compose.production.yml";
const envFile = process.env.DEPLOYMENT_ENV_FILE ?? ".env.production.example";

const allowedCapabilityAdds = {
  caddy: ["NET_BIND_SERVICE"],
  postgres: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"],
  valkey: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"],
};

function normalizedList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(String).sort();
}

function normalizedPorts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((port) => {
    if (typeof port === "object" && port !== null) return { published: String(port.published ?? ""), target: String(port.target ?? "") };
    const parts = String(port).split(":");
    const container = parts.at(-1)?.split("/")[0] ?? "";
    const published = parts.length > 1 ? parts.at(-2)?.split("/")[0] ?? "" : container;
    return { published, target: container };
  });
}

function mountTargets(value) {
  if (!Array.isArray(value)) return [];
  return value.map((volume) => (typeof volume === "object" && volume !== null ? String(volume.target ?? "") : String(volume).split(":")[1] ?? ""));
}

export function verifyTopology(compose, caddyfile, dockerfile) {
  const services = compose.services ?? {};
  const required = ["app", "scheduler", "backup-worker", "postgres", "valkey", "minio", "caddy"];
  for (const name of required) {
    if (!services[name]) throw new Error(`Deployment topology is incomplete: missing ${name}`);
    if (!["unless-stopped", "always"].includes(services[name].restart)) throw new Error(`${name} must restart after host/process failure`);
    if (!Array.isArray(services[name].cap_drop) || !services[name].cap_drop.includes("ALL")) throw new Error(`${name} must drop all Linux capabilities`);
    const expectedCapAdd = normalizedList(allowedCapabilityAdds[name]);
    const actualCapAdd = normalizedList(services[name].cap_add);
    if (JSON.stringify(actualCapAdd) !== JSON.stringify(expectedCapAdd)) throw new Error(`${name} has unsupported Linux capability exceptions`);
    if (services[name].pids_limit === undefined) throw new Error(`${name} must define a PID limit`);
    if (!services[name].security_opt?.includes("no-new-privileges:true")) throw new Error(`${name} must enable no-new-privileges`);
    if (["postgres", "valkey", "minio"].includes(name) && services[name].ports?.length) throw new Error(`${name} must remain private without published ports`);
  }
  if (services.migrate && services.migrate.restart !== "no") throw new Error("migrate must be a one-shot service with restart=no");
  const caddy = services.caddy;
  const app = services.app;
  const caddyPorts = normalizedPorts(caddy.ports);
  if (!caddyPorts.some((port) => port.target === "443")) throw new Error("HTTPS port 443 is not exposed by caddy");
  if (!caddyPorts.some((port) => port.target === "80") && caddyPorts.some((port) => port.published === "80")) throw new Error("Caddy port 80 must map to container port 80");
  if (caddyPorts.some((port) => ["80", "443"].includes(port.target)) && !caddy.cap_add?.includes("NET_BIND_SERVICE")) throw new Error("Caddy must retain only NET_BIND_SERVICE so the executable can bind HTTPS/HTTP after dropping capabilities");
  if (caddy.command || caddy.entrypoint) throw new Error("Caddy must use the image executable entrypoint");
  if (!app.healthcheck) throw new Error("Application image must declare a healthcheck in Compose");
  if (caddy.depends_on?.app?.condition !== "service_healthy") throw new Error("Proxy must depend on a healthy application");
  const appNetworks = new Set(Array.isArray(app.networks) ? app.networks : Object.keys(app.networks ?? {}));
  const caddyNetworks = new Set(Array.isArray(caddy.networks) ? caddy.networks : Object.keys(caddy.networks ?? {}));
  if (![...appNetworks].some((network) => caddyNetworks.has(network))) throw new Error("Proxy and application must share a network");
  if (!mountTargets(caddy.volumes).includes("/etc/caddy/Caddyfile")) throw new Error("Caddyfile must be mounted into the proxy container");
  if (!/reverse_proxy\s+app:3000\b/.test(caddyfile)) throw new Error("Caddy must reverse proxy to app:3000");
  if (!/\$\{APP_DOMAIN\}/.test(caddyfile)) throw new Error("Caddy must configure the deployment application domain");
  if (!dockerfile.includes("HEALTHCHECK")) throw new Error("Application image must declare a healthcheck");
  return { required, checks: ["restart-policies", "one-shot-migrations", "https-proxy", "caddy-executable", "caddy-bind-ports", "healthy-proxy-upstream", "shared-proxy-network", "healthchecks", "capability-drop", "narrow-capability-exceptions", "private-dependencies", "pid-limits", "no-new-privileges"] };
}

export function loadAndVerify({ composePath = composeFile, environmentPath = envFile, caddyPath = "Caddyfile", dockerfilePath = "Dockerfile" } = {}) {
  if (!existsSync(composePath)) throw new Error(`Missing deployment compose file: ${composePath}`);
  if (!existsSync(environmentPath)) throw new Error(`Missing deployment environment template: ${environmentPath}`);
  if (!existsSync(caddyPath)) throw new Error("Missing HTTPS proxy configuration: Caddyfile");
  const compose = JSON.parse(execFileSync("docker", ["compose", "--env-file", environmentPath, "-f", composePath, "config", "--format", "json"], { encoding: "utf8" }));
  return verifyTopology(compose, readFileSync(caddyPath, "utf8"), readFileSync(dockerfilePath, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify({ ok: true, composeFile, ...loadAndVerify() }));
