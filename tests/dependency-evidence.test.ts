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
});
