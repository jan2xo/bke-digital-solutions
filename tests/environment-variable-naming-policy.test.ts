import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const roots = [
  ".env.example",
  "platform/host/config/environment.ts",
  "apps/standalone/bootstrap.ts",
  "scripts",
  ".github/workflows",
] as const;

const versionPrefixedName = /\bV\d+_[A-Z][A-Z0-9_]*\b/g;

function collect(path: string): string[] {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat) return [];
  if (stat.isFile()) return [path];
  return readdirSync(path).flatMap((name) => collect(join(path, name)));
}

function environmentNames(path: string, source: string): string[] {
  if (path === ".env.example") {
    return source
      .split("\n")
      .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
      .filter((value): value is string => Boolean(value));
  }

  if (/\.ya?ml$/.test(path)) {
    return source
      .split("\n")
      .map((line) => line.match(/^\s+([A-Z][A-Z0-9_]*):(?:\s|$)/)?.[1])
      .filter((value): value is string => Boolean(value));
  }

  const names = new Set<string>();
  for (const pattern of [
    /(?:process\.env\.|env\.)([A-Z][A-Z0-9_]*)\b/g,
    /(?:requireEnvironment|required)\(["']([A-Z][A-Z0-9_]*)["']\)/g,
    /^\s{2}([A-Z][A-Z0-9_]*):\s/gm,
  ]) {
    for (const match of source.matchAll(pattern)) names.add(match[1]!);
  }
  return [...names];
}

describe("environment variable naming policy", () => {
  it("keeps runtime and certification environment names generation-free", () => {
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of collect(root)) {
        if (!/\.(?:ts|tsx|js|mjs|cjs|yml|yaml)$/.test(file) && file !== ".env.example") continue;
        const source = readFileSync(file, "utf8");
        for (const name of environmentNames(file, source)) {
          if (versionPrefixedName.test(name)) offenders.push(`${file}: ${name}`);
          versionPrefixedName.lastIndex = 0;
        }
      }
    }

    expect(
      offenders,
      [
        "Environment variables must describe capabilities, not product generations.",
        "Use CLAIM_CODE_CHECKOUT_ENABLED, not V3_CLAIM_CODE_CHECKOUT_ENABLED.",
        "A suffix such as *_KEY_VERSION is allowed when version is part of the data/security concept.",
      ].join("\n"),
    ).toEqual([]);
  });
});
