import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { env } from "@/lib/env";
import { currentApproval } from "@/lib/releases/approval";

export type ReadinessItem = { key: string; label: string; status: "PASS" | "PENDING" | "BLOCKED"; detail: string };

/** Active release readiness deliberately excludes dormant automated certification. */
export function releaseReadiness(version: { id?: string; productId: string; version: string; product: { slug: string }; artifacts: Array<{ id: string; objectKey: string; sha256: string; sizeBytes: bigint; contentType: string }>; approvals: Array<{ payloadHash?: string | null; approvedAt: Date | null; approvedById?: string | null; reviewedAt?: Date | null; reviewedById?: string | null; createdById?: string }> }, options: { complianceCurrent?: boolean } = {}): { items: ReadinessItem[]; publishable: boolean; payloadHash: string } {
  const manifest = buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id ?? "", version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
  const payloadHash = manifestHash(canonicalizeManifest(manifest));
  const artifactsValid = version.artifacts.length > 0 && version.artifacts.every((artifact) => Boolean(artifact.objectKey) && /^[a-f0-9]{64}$/i.test(artifact.sha256) && artifact.sizeBytes > 0n);
  const approval = currentApproval(version.approvals, payloadHash);
  const items: ReadinessItem[] = [
    { key: "artifact", label: "Artifact verification", status: artifactsValid ? "PASS" : "BLOCKED", detail: artifactsValid ? "Exact SHA-256 and canonical size recorded" : "A verified artifact with SHA-256 and size is required" },
    { key: "review", label: "Human review", status: approval.valid && Boolean(approval.approval?.reviewedAt) ? "PASS" : "BLOCKED", detail: approval.valid && approval.approval?.reviewedAt ? "Reviewed for the current artifact payload" : "Human review required" },
    { key: "approval", label: "Human approval", status: approval.valid && Boolean(approval.approval?.approvedAt) ? "PASS" : "BLOCKED", detail: approval.valid && approval.approval?.approvedAt ? "Approved for the current artifact payload" : "Human approval required" },
  ];
  if (options.complianceCurrent === false) items.push({ key: "compliance", label: "Legal/compliance", status: "BLOCKED", detail: "Required legal/compliance action is incomplete" });
  return { items, publishable: items.every((item) => item.status === "PASS"), payloadHash };
}
