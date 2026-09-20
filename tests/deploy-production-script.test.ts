import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../scripts/deploy-production.sh", import.meta.url), "utf8");

describe("production deployment automation contract", () => {
  it("uses strict mode and protects the checked-out revision", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("git status --porcelain=v1 --untracked-files=all");
    expect(script).toContain("git rev-parse HEAD");
  });

  it("keeps validation and deployment stages ordered", () => {
    const preflight = script.indexOf("npm run ops:validate");
    const compose = script.indexOf('docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet');
    const build = script.indexOf('docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build');
    const migrate = script.indexOf("--profile operations run --rm migrate");
    const start = script.indexOf(" up -d app scheduler backup-worker caddy");
    const health = script.indexOf('npm run ops:health -- "$HEALTH_URL"');
    expect(preflight).toBeGreaterThan(-1);
    expect(compose).toBeGreaterThan(preflight);
    expect(build).toBeGreaterThan(compose);
    expect(migrate).toBeGreaterThan(build);
    expect(start).toBeGreaterThan(migrate);
    expect(health).toBeGreaterThan(start);
  });

  it("does not print environment contents or secrets", () => {
    expect(script).not.toMatch(/cat\s+.*\.env/);
    expect(script).not.toMatch(/printenv|env\s*\|/);
    expect(script).not.toContain("set -x");
  });
});
