import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const caddy = readFileSync("Caddyfile", "utf8");
const compose = readFileSync("docker-compose.production.yml", "utf8");
const page = readFileSync("app/licensing-agent/page.tsx", "utf8");

describe("Licensing Agent distribution", () => {
  it("uses fixed current-only platform mappings", () => {
    expect(caddy).toContain("/licensing-agent/windows/download");
    expect(caddy).toContain("/windows/BKELicensingAgentSetup.exe");
    expect(caddy).toContain("/licensing-agent/macos/download");
    expect(caddy).toContain("/macos/BKELicensingAgentSetup.pkg");
    expect(caddy).toContain("/licensing-agent/linux/download");
    expect(caddy).toContain("/linux/BKELicensingAgentSetup.deb");
    expect(compose).toContain("/opt/bkes/licensing-agent:ro");
    expect(caddy).toContain("reverse_proxy app:3000");
  });

  it("does not expose a generic static filesystem or binaries in Git", () => {
    expect((caddy.match(/file_server/g) ?? []).length).toBe(3);
    expect(page).toContain("Licensing Agent");
    expect(page).toContain("Coming soon");
    expect(page).toContain("© 2026 BKES Digital Solutions. All rights reserved.");
  });

  it("derives visible availability from the fixed runtime paths", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
    expect(page).toContain("/opt/bkes/licensing-agent/windows/BKELicensingAgentSetup.exe");
    expect(page).toContain("/opt/bkes/licensing-agent/macos/BKELicensingAgentSetup.pkg");
    expect(page).toContain("/opt/bkes/licensing-agent/linux/BKELicensingAgentSetup.deb");
    expect(page).toContain("access(path)");
    expect(page).not.toContain("process.cwd()");
  });
});
