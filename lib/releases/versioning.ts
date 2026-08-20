export function parseSemanticVersion(value: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) throw new Error("invalid version");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemanticVersions(left: string, right: string): number {
  const a = parseSemanticVersion(left);
  const b = parseSemanticVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}
