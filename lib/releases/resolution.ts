import { db } from "@/lib/db";
import { CUSTOMER_RELEASE_LIFECYCLES } from "@/lib/releases/eligibility";
import { releaseReadiness } from "@/lib/supply-chain/readiness";
import { selectNewestSemanticRelease } from "@/lib/releases/versioning";

export const UPDATE_PACKAGE_CONTENT_TYPE = "application/vnd.bke.update-package+zip";

export async function resolveCurrentCustomerRelease(productId: string) {
  return db.productVersion.findFirst({
    where: { productId, active: true, publishedAt: { not: null }, lifecycle: { in: [...CUSTOMER_RELEASE_LIFECYCLES] } },
    orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }, { version: "desc" }],
    include: { artifacts: { where: { active: true, removedAt: null } } },
  });
}

export async function resolveAgentUpdateRelease(input: {
  canonicalProductId: string;
  currentVersion: string;
  platform: string;
  architecture: string;
  channel: "stable" | "lts";
  sameMajorOnly?: boolean;
}) {
  const lifecycle = input.channel === "lts" ? "LTS" : "STABLE";
  const candidates = await db.productVersion.findMany({
    where: {
      active: true,
      publishedAt: { not: null },
      lifecycle,
      operatingSystem: { equals: input.platform, mode: "insensitive" },
      architecture: { equals: input.architecture, mode: "insensitive" },
      product: { productId: input.canonicalProductId, active: true, archivedAt: null },
    },
    include: {
      product: true,
      artifacts: { where: { active: true, removedAt: null } },
      supplyChainEvidence: { include: { verificationEvidence: true } },
      approvals: true,
    },
  });
  const eligible = candidates.filter((candidate) =>
    candidate.artifacts.filter((artifact) => artifact.contentType === UPDATE_PACKAGE_CONTENT_TYPE).length === 1 &&
    releaseReadiness(candidate).publishable,
  );
  const selected = selectNewestSemanticRelease(eligible, input.currentVersion, input.sameMajorOnly);
  if (!selected) return null;
  const updateArtifact = selected.artifacts.find((artifact) => artifact.contentType === UPDATE_PACKAGE_CONTENT_TYPE);
  return updateArtifact ? { ...selected, updateArtifact } : null;
}

export async function resolveEligibleReleaseForArtifact(artifactId: string) {
  const artifact = await db.productArtifact.findFirst({
    where: {
      id: artifactId,
      active: true,
      removedAt: null,
      version: { active: true, publishedAt: { not: null }, lifecycle: { in: [...CUSTOMER_RELEASE_LIFECYCLES] } },
      product: { active: true, archivedAt: null },
    },
    include: { version: { include: { product: true, artifacts: { where: { active: true, removedAt: null } }, supplyChainEvidence: { include: { verificationEvidence: true } }, approvals: true } } },
  });
  if (!artifact?.version) return null;
  const readiness = releaseReadiness(artifact.version);
  return readiness.publishable ? artifact : null;
}
