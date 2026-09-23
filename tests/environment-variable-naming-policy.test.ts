import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const roots = [
  ".env.example",
  "app",
  "apps",
  "components",
  "modules",
  "platform",
  "scripts",
  ".github/workflows",
] as const;

const VERSIONED_ENV = /\bV\d+_[A-Z][A-Z0-9_]*\b/g;

function collect(path: string): string[] {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((name) => collect(join(path, name)));
}

describe("environment variable naming policy", () => {
  it("keeps runtime and certification environment names generation-free", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of collect(root)) {
        if (!/\.(?:ts|tsx|js|mjs|cjs|yml|yaml|env|example)$/.test(file) && file !== ".env.example") continue;
        const source = readFileSync(file, "utf8");
        for (const match of source.matchAll(VERSIONED_ENV)) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(
      offenders,
      [
        "Environment variables must describe capabilities, not product generations.",
        "Use CLAIM_CODE_CHECKOUT_ENABLED, not V3_CLAIM_CODE_CHECKOUT_ENABLED.",
        "Versions belong only where version is protocol/data/key semantics, not release lineage.",
      ].join("\n"),
    ).toEqual([]);
  });
});
