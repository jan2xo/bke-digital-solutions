import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { verifyRestartPolicies } from "../scripts/verify-compose-restart-policies.mjs";

const compose = {
  services: {
    app: { restart: "unless-stopped", healthcheck: {} },
    scheduler: { restart: "unless-stopped", healthcheck: {} },
    "backup-worker": { restart: "unless-stopped", healthcheck: {} },
    postgres: { restart: "unless-stopped" },
    valkey: { restart: "unless-stopped" },
    minio: { restart: "unless-stopped" },
    caddy: { restart: "unless-stopped" },
    migrate: { restart: "no" },
  },
};

describe("compose recovery policy verifier", () => {
  it("production scheduler healthcheck uses the durable scheduler contract", () => {
    const composeFile = readFileSync("docker-compose.production.yml", "utf8");
    expect(composeFile).toContain("http://app:3000/api/health/scheduler");
    expect(composeFile).not.toContain("target: scheduler\n    healthcheck: NONE");
  });
  it("does not require a fabricated backup-worker probe", () => {
    const services = { ...compose.services, "backup-worker": { restart: "unless-stopped" } };
    expect(() => verifyRestartPolicies({ services })).not.toThrow();
  });
  it("accepts long-running services with healthchecks and a one-shot migration", () => {
    expect(verifyRestartPolicies(compose)).toMatchObject({ ok: true, migration: "no" });
  });

  it.each([
    ["missing scheduler healthcheck", { scheduler: { restart: "unless-stopped" } }, "scheduler: missing healthcheck"],
    ["missing application healthcheck", { app: { restart: "unless-stopped" } }, "app: missing healthcheck"],
    ["restartable migration", { migrate: { restart: "always" } }, "migrate must remain one-shot"],
    ["missing caddy restart policy", { caddy: { restart: "no" } }, "caddy: missing long-running restart policy"],
  ])("rejects %s", (_label, change, message) => {
    const services = { ...compose.services, ...change };
    expect(() => verifyRestartPolicies({ services })).toThrow(message);
  });
});
