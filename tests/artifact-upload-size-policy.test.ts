import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAX_SUPPORTED_ARTIFACT_BYTES = 536_870_912; // 512 MiB

describe("direct artifact upload size policy", () => {
  it("keeps production artifact and malware ceilings aligned at 512 MiB", () => {
    const productionEnv = readFileSync(".env.production.example", "utf8");
    const artifactBytes = Number(productionEnv.match(/^MAX_ARTIFACT_BYTES=(\d+)$/m)?.[1]);
    const malwareBytes = Number(productionEnv.match(/^MALWARE_SCANNER_MAX_BYTES=(\d+)$/m)?.[1]);

    expect(artifactBytes).toBe(MAX_SUPPORTED_ARTIFACT_BYTES);
    expect(malwareBytes).toBe(MAX_SUPPORTED_ARTIFACT_BYTES);
  });

  it("keeps the direct Caddy upload ceiling above the canonical artifact ceiling", () => {
    const caddyfile = readFileSync("Caddyfile", "utf8");
    const uploadBlock = caddyfile.split("{$APP_DOMAIN}")[0];
    const caddyMegabytes = Number(uploadBlock.match(/max_size\s+(\d+)MB/)?.[1]);
    const caddyBytes = caddyMegabytes * 1_000_000;

    expect(caddyMegabytes).toBeGreaterThan(0);
    expect(caddyBytes).toBeGreaterThanOrEqual(MAX_SUPPORTED_ARTIFACT_BYTES);
  });
});
