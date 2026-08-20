import { db } from "@/lib/db";
import { CUSTOMER_RELEASE_LIFECYCLES } from "@/lib/releases/eligibility";

export async function resolveCurrentCustomerRelease(productId: string, platform?: string, architecture?: string, channel: "stable"|"lts" = "stable") {
  const lifecycle = channel === "lts" ? "LTS" : "STABLE";
  return db.productVersion.findFirst({
    where: {
      productId, active: true, publishedAt: { not: null },
      lifecycle: lifecycle as "STABLE"|"LTS",
      ...(channel === "stable" ? { channel: "STABLE" as const } : {}),
      ...(platform ? { operatingSystem: { equals: platform, mode: "insensitive" as const } } : {}),
      ...(architecture ? { architecture: { equals: architecture, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }, { version: "desc" }],
    include: { artifacts: { where: { active: true, removedAt: null } } },
  });
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
