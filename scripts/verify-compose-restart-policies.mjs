import { execFileSync } from "node:child_process";
const raw = execFileSync("docker", ["compose", "--env-file", ".env.production.example", "-f", "docker-compose.production.yml", "config", "--format", "json"], { encoding: "utf8" });
const services = JSON.parse(raw).services;
const expected = ["app", "scheduler", "backup-worker", "postgres", "valkey", "caddy"];
if (services.minio) expected.push("minio");
for (const name of expected) if (!["unless-stopped", "always"].includes(services[name]?.restart)) throw new Error(`${name}: missing long-running restart policy`);
if (services.migrate?.restart !== undefined && services.migrate?.restart !== "no") throw new Error("migrate must remain one-shot with restart=no");
console.log(JSON.stringify({ ok: true, longRunning: expected, migration: services.migrate?.restart }));
