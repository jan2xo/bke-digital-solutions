import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { env } from "@/lib/env";
export type ReadinessItem = { key: string; label: string; status: "PASS" | "PENDING" | "BLOCKED"; detail: string };
export function releaseReadiness(version: { id?: string; productId: string; version: string; product: { slug: string }; artifacts: Array<{ id: string; objectKey: string; sha256: string; sizeBytes: bigint; contentType: string }>; supplyChainEvidence: { signatureVerified: boolean; signatureKeyId: string | null; sbomReference: string | null; provenanceStatus: string; dependencyVerified: boolean; malwareStatus: string; verificationEvidence: Array<{ kind: string; result: string; artifactHash: string; metadata: unknown }> } | null; backupEvidence: string | null; complianceEvidence: string | null; migrationEvidence: string | null; approvals: Array<{ approvedAt: Date | null; reviewedById: string | null }> }): { items: ReadinessItem[]; publishable: boolean; payloadHash: string } {
  const manifest = buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id ?? "", version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
  const payloadHash = manifestHash(canonicalizeManifest(manifest)); const evidence = version.supplyChainEvidence;
  const current = (kind: string, result: string) => evidence?.verificationEvidence.some((item) => item.kind === kind && item.result === result && item.artifactHash === payloadHash) ?? false;
  const cleanIds = new Set((evidence?.verificationEvidence ?? []).filter((item) => item.kind === "MALWARE_SCAN" && item.result === "CLEAN" && item.artifactHash === payloadHash).map((item) => typeof item.metadata === "object" && item.metadata && "artifactId" in item.metadata ? String((item.metadata as { artifactId: unknown }).artifactId) : ""));
  const malware = version.artifacts.length > 0 && cleanIds.size === version.artifacts.length && version.artifacts.every((a) => cleanIds.has(a.id));
  const items: ReadinessItem[] = [
    { key: "signature", label: "Signature", status: current("SIGNATURE", "VERIFIED") ? "PASS" : "BLOCKED", detail: evidence?.signatureKeyId ?? "Missing current signature" },
    { key: "malware", label: "Malware", status: malware ? "PASS" : "BLOCKED", detail: malware ? "All current artifacts CLEAN" : evidence?.malwareStatus ?? "Missing current evidence" },
    { key: "sbom", label: "SBOM", status: evidence?.sbomReference ? "PASS" : "BLOCKED", detail: evidence?.sbomReference ?? "Missing" },
    { key: "provenance", label: "Provenance", status: evidence?.provenanceStatus === "VERIFIED" ? "PASS" : "BLOCKED", detail: evidence?.provenanceStatus ?? "Missing" },
    { key: "dependencies", label: "Dependencies", status: evidence?.dependencyVerified ? "PASS" : "BLOCKED", detail: evidence?.dependencyVerified ? "Verified" : "Missing" },
    { key: "backup", label: "Backup", status: version.backupEvidence ? "PASS" : "BLOCKED", detail: version.backupEvidence ?? "Missing" },
    { key: "compliance", label: "Compliance", status: version.complianceEvidence ? "PASS" : "BLOCKED", detail: version.complianceEvidence ?? "Missing" },
    { key: "migration", label: "Migration", status: version.migrationEvidence ? "PASS" : "BLOCKED", detail: version.migrationEvidence ?? "Missing" },
    { key: "approval", label: "Approval", status: version.approvals[0]?.approvedAt && version.approvals[0].reviewedById ? "PASS" : "BLOCKED", detail: version.approvals[0]?.approvedAt ? "Approved" : "Pending" },
  ]; return { items, publishable: items.every((item) => item.status === "PASS"), payloadHash };
}
