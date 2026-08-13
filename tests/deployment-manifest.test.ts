import { describe, expect, it } from "vitest";
import { verifyTopology } from "../scripts/verify-deployment-manifest.mjs";

const baseCompose = {
  services: {
    app: { restart: "unless-stopped", healthcheck: {}, networks: ["private", "egress"] },
    scheduler: { restart: "unless-stopped" },
    "backup-worker": { restart: "unless-stopped" },
    postgres: { restart: "unless-stopped" },
    valkey: { restart: "unless-stopped" },
    minio: { restart: "unless-stopped" },
    migrate: { restart: "no" },
    caddy: {
      restart: "unless-stopped",
      depends_on: { app: { condition: "service_healthy" } },
      ports: [{ published: 443, target: 443 }],
      volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"],
      networks: ["private", "egress"],
    },
  },
};
const caddyfile = "${APP_DOMAIN} { reverse_proxy app:3000 }";
const dockerfile = "HEALTHCHECK CMD node health.js";

function composeWith(change: Record<string, unknown>) {
  return { ...baseCompose, services: { ...baseCompose.services, ...change } };
}

describe("deployment manifest topology verifier", () => {
  it("accepts the effective production topology", () => {
    expect(verifyTopology(baseCompose, caddyfile, dockerfile).checks).toContain("healthy-proxy-upstream");
  });

  it.each([
    ["a proxy without a healthy dependency", composeWith({ caddy: { ...baseCompose.services.caddy, depends_on: { app: { condition: "service_started" } } } }), "healthy application"],
    ["a proxy isolated from the app", composeWith({ caddy: { ...baseCompose.services.caddy, networks: ["public"] } }), "share a network"],
    ["a proxy without the Caddyfile mount", composeWith({ caddy: { ...baseCompose.services.caddy, volumes: [] } }), "Caddyfile must be mounted"],
    ["a Caddyfile targeting the wrong upstream", baseCompose, "reverse proxy to app:3000"],
  ])("rejects %s", (_label, compose, message) => {
    const config = _label === "a Caddyfile targeting the wrong upstream" ? "${APP_DOMAIN} { reverse_proxy wrong:3000 }" : caddyfile;
    expect(() => verifyTopology(compose, config, dockerfile)).toThrow(message);
  });
});
