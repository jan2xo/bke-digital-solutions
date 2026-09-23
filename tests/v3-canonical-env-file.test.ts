import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retiredProductionTemplate = [".env", "production", "example"].join(".");
const retiredProductionRuntime = [".env", "production"].join(".");
const retiredVpsRuntime = [".env", "vps"].join(".");

function trackedTextFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((file) => !/\.(?:png|jpe?g|gif|ico|woff2?|pdf|lock|bin)$/i.test(file));
}

describe("V3 canonical environment file contract", () => {
  it("uses .env as the only runtime/deployment filename", () => {
    const violations: string[] = [];
    for (const file of trackedTextFiles()) {
      let source: string;
      try {
        source = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const retired of [retiredProductionTemplate, retiredProductionRuntime, retiredVpsRuntime]) {
        if (source.includes(retired)) violations.push(`${file}: ${retired}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps one committed runtime template and no retired production template", () => {
    expect(existsSync(".env.example")).toBe(true);
    expect(existsSync(retiredProductionTemplate)).toBe(false);

    const template = readFileSync(".env.example", "utf8");
    expect(template).toContain("AGENT_ACCOUNT_SESSION_ENABLED=false");
    expect(template).toContain("AGENT_ACCOUNT_SESSION_PEPPER=");
    expect(template).toContain("AGENT_ACCOUNT_SESSION_ENCRYPTION_KEY=");
    expect(template).toContain("APP_DOMAIN=");
    expect(template).toContain("POSTGRES_DB=");
    expect(template).toContain("MINIO_ROOT_USER=");
  });

  it("makes deployment tooling default to .env", () => {
    const deploy = readFileSync("scripts/deploy-production.sh", "utf8");
    const ops = readFileSync("scripts/ops-validate-production.mjs", "utf8");
    const restart = readFileSync("scripts/verify-compose-restart-policies.mjs", "utf8");
    const manifest = readFileSync("scripts/verify-deployment-manifest.mjs", "utf8");

    expect(deploy).toContain('ENV_INPUT=".env"');
    expect(ops).toContain('DEPLOYMENT_ENV_FILE ?? ".env"');
    expect(restart).toContain('DEPLOYMENT_ENV_FILE ?? ".env"');
    expect(manifest).toContain('DEPLOYMENT_ENV_FILE ?? ".env"');
  });
});
