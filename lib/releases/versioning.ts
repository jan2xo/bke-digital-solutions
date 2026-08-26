import { compare, parse } from "semver";

export type SemanticVersion = readonly [number, number, number, string | null];

export function parseSemanticVersion(value: string): SemanticVersion {
  const parsed = parse(value, { loose: false });
  if (!parsed) throw new Error("INVALID_SEMANTIC_VERSION");
  return [parsed.major, parsed.minor, parsed.patch, parsed.prerelease.length ? parsed.prerelease.join(".") : null];
}

export function compareSemanticVersions(left: string, right: string): number {
  parseSemanticVersion(left); parseSemanticVersion(right);
  return compare(left, right);
}

export function selectNewestSemanticRelease<T extends { version: string }>(candidates: T[], currentVersion: string, sameMajorOnly = false): T | null {
  const current = parseSemanticVersion(currentVersion);
  return candidates
    .filter((candidate) => {
      try {
        return compareSemanticVersions(candidate.version, currentVersion) > 0 &&
          (!sameMajorOnly || parseSemanticVersion(candidate.version)[0] === current[0]);
      }
      catch { return false; }
    })
    .sort((left, right) => compareSemanticVersions(right.version, left.version))[0] ?? null;
}
