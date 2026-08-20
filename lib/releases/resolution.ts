import { db } from "@/lib/db";
import { CUSTOMER_RELEASE_LIFECYCLES } from "@/lib/releases/eligibility";
import { compareSemanticVersions, parseSemanticVersion } from "@/lib/releases/versioning";

export async function resolveCurrentCustomerRelease(
  productId: string,
  platform?: string,
  architecture?: string,
  channel: "stable"|"lts" = "stable",
  updatePolicy: string = "LIFETIME",
  currentVersion?: string,
) {
  const lifecycle = channel === "lts" ? "LTS" : "STABLE";
  const candidates = await db.productVersion.findMany({
    where: {
      productId, active: true, publishedAt: { not: null },
      lifecycle: lifecycle as "STABLE"|"LTS",
      ...(channel === "stable" ? { channel: "STABLE" as const } : {}),
      ...(platform ? { operatingSystem: { equals: platform, mode: "insensitive" as const } } : {}),
      ...(architecture ? { architecture: { equals: architecture, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }],
    include: { artifacts: { where: { active: true, removedAt: null } } },
  });

  let eligible = candidates.filter((candidate) => {
    try {
      parseSemanticVersion(candidate.version);
      return candidate.artifacts.some((artifact) => artifact.active && !artifact.removedAt && artifact.sha256 && Number(artifact.sizeBytes) >= 0);
    } catch {
      return false;
    }
  });

  if (updatePolicy === "MAJOR_VERSION" && currentVersion) {
    const entitledMajor = parseSemanticVersion(currentVersion)[0];
    eligible = eligible.filter((candidate) => parseSemanticVersion(candidate.version)[0] === entitledMajor);
  }

  eligible.sort((left, right) => compareSemanticVersions(right.version, left.version));
  return eligible[0] ?? null;
}

export async function resolveEligibleReleaseForArtifact(artifactId: string) {
  return db.productArtifact.findFirst({
    where: {
      id: artifactId, active: true, removedAt: null,
      version: { active: true, publishedAt: { not: null }, lifecycle: { in: [...CUSTOMER_RELEASE_LIFECYCLES] } },
      product: { active: true, archivedAt: null },
    },
    include: { version: true },
  });
}
