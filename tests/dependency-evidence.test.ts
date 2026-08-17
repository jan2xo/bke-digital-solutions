import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("dependency evidence operations", () => {
  it("uses lockfile, resolution, and audit checks and emits a versioned document", () => {
    const script = readFileSync("scripts/generate-dependency-evidence.mjs", "utf8");
    expect(script).toContain('"npm", ["ci", "--ignore-scripts"]');
    expect(script).toContain('"npm", ["ls", "--all", "--json"]');
    expect(script).toContain('"npm", ["audit", "--json", "--omit=dev"]');
    expect(script).toContain("bke.dependency-evidence.v1");
    expect(readFileSync("package.json", "utf8")).toContain('"supplychain:dependencies"');
    expect(script).toContain("mkdtemp(join(tmpdir(), \"bke-dependencies-\")");
    expect(script).toContain("sourceNodeModulesUsed: false");
    expect(script).toContain("finally");
  });

  it("provides a fail-closed first-class evidence package generator", () => {
    const script = readFileSync("scripts/generate-supply-chain-evidence.mjs", "utf8");
    expect(readFileSync("package.json", "utf8")).toContain('"supplychain:generate"');
    expect(script).toContain("generate-sbom.mjs");
    expect(script).toContain("generate-provenance.mjs");
    expect(script).toContain("generate-dependency-evidence.mjs");
    expect(script).toContain('"prisma", "migrate", "status"');
    expect(script).toContain("database schema is up to date");
    expect(script).toContain("process.exitCode = 1");
    expect(script).toContain('createHash("sha256")');
    expect(script).not.toContain("RECORD_");
  });
});
