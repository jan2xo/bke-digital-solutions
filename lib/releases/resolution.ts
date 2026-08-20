import { db } from "@/lib/db";
import { CUSTOMER_RELEASE_LIFECYCLES } from "@/lib/releases/eligibility";
import { releaseReadiness } from "@/lib/supply-chain/readiness";

export async function resolveCurrentCustomerRelease(productId: string) {
  return db.productVersion.findFirst({
    where: { productId, active: true, publishedAt: { not: null }, lifecycle: { in: [...CUSTOMER_RELEASE_LIFECYCLES] } },
    orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }, { version: "desc" }],
    include: { artifacts: { where: { active: true, removedAt: null } } },
  });
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
