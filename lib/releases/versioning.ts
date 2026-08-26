const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export type SemanticVersion = readonly [number, number, number, string | null];

export function parseSemanticVersion(value: string): SemanticVersion {
  const match = SEMVER.exec(value);
  if (!match) throw new Error("INVALID_SEMANTIC_VERSION");
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? null];
}

export function compareSemanticVersions(left: string, right: string): number {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3].localeCompare(b[3]);
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
