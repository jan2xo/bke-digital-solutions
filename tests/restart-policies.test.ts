import { describe, expect, it } from "vitest";
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
