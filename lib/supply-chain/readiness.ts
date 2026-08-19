import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { env } from "@/lib/env";
import { currentApproval } from "@/lib/releases/approval";
import { isCommercialComplianceEvidence } from "@/lib/supply-chain/compliance-certification";
export type ReadinessItem = { key: string; label: string; status: "PASS" | "PENDING" | "BLOCKED"; detail: string };
export function releaseReadiness(version: { id?: string; productId: string; version: string; product: { slug: string }; artifacts: Array<{ id: string; objectKey: string; sha256: string; sizeBytes: bigint; contentType: string }>; supplyChainEvidence: { signatureVerified: boolean; signatureKeyId: string | null; sbomReference: string | null; provenanceStatus: string; dependencyVerified: boolean; malwareStatus: string; verificationEvidence: Array<{ kind: string; result: string; artifactHash: string; metadata: unknown }> } | null; backupEvidence: string | null; complianceEvidence: string | null; migrationEvidence: string | null; approvals: Array<{ payloadHash?: string | null; approvedAt: Date | null; approvedById?: string | null; reviewedAt?: Date | null; reviewedById?: string | null; createdById?: string }> }): { items: ReadinessItem[]; publishable: boolean; payloadHash: string } {
  const manifest = buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id ?? "", version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
  const payloadHash = manifestHash(canonicalizeManifest(manifest)); const evidence = version.supplyChainEvidence;
  const current = (kind: string, result: string) => evidence?.verificationEvidence.some((item) => item.kind === kind && item.result === result && item.artifactHash === payloadHash) ?? false;
  const cleanIds = new Set((evidence?.verificationEvidence ?? []).filter((item) => item.kind === "MALWARE_SCAN" && item.result === "CLEAN" && item.artifactHash === payloadHash).map((item) => typeof item.metadata === "object" && item.metadata && "artifactId" in item.metadata ? String((item.metadata as { artifactId: unknown }).artifactId) : ""));
  const malware = version.artifacts.length > 0 && cleanIds.size === version.artifacts.length && version.artifacts.every((a) => cleanIds.has(a.id));
  const complianceCurrent = evidence?.verificationEvidence.some((item) => isCommercialComplianceEvidence(item, version.id ?? "", payloadHash)) ?? false;
  const approval = currentApproval(version.approvals, payloadHash);
  const items: ReadinessItem[] = [
    { key: "signature", label: "Signature", status: current("SIGNATURE", "VERIFIED") ? "PASS" : "BLOCKED", detail: evidence?.signatureKeyId ?? "Missing current signature" },
    { key: "malware", label: "Malware", status: malware ? "PASS" : "BLOCKED", detail: malware ? "All current artifacts CLEAN" : evidence?.malwareStatus ?? "Missing current evidence" },
    { key: "sbom", label: "SBOM", status: current("SBOM", "VERIFIED") && Boolean(evidence?.sbomReference) ? "PASS" : "BLOCKED", detail: current("SBOM", "VERIFIED") ? evidence?.sbomReference ?? "Missing" : "Missing current evidence" },
    { key: "provenance", label: "Provenance", status: current("PROVENANCE", "VERIFIED") && evidence?.provenanceStatus === "VERIFIED" ? "PASS" : "BLOCKED", detail: current("PROVENANCE", "VERIFIED") ? evidence?.provenanceStatus ?? "Missing" : "Missing current evidence" },
    { key: "dependencies", label: "Dependencies", status: evidence?.dependencyVerified === true && current("DEPENDENCIES", "VERIFIED") ? "PASS" : "BLOCKED", detail: evidence?.dependencyVerified && current("DEPENDENCIES", "VERIFIED") ? "Verified" : "Missing current evidence" },
    { key: "backup", label: "Backup", status: Boolean(version.backupEvidence) && current("BACKUP", "VERIFIED") ? "PASS" : "BLOCKED", detail: version.backupEvidence && current("BACKUP", "VERIFIED") ? version.backupEvidence : "Missing current evidence" },
    { key: "compliance", label: "Compliance", status: Boolean(version.complianceEvidence) && complianceCurrent ? "PASS" : "BLOCKED", detail: version.complianceEvidence && complianceCurrent ? version.complianceEvidence : "Missing current commercial evidence" },
    { key: "migration", label: "Migration", status: Boolean(version.migrationEvidence) && current("MIGRATION", "VERIFIED") ? "PASS" : "BLOCKED", detail: version.migrationEvidence && current("MIGRATION", "VERIFIED") ? version.migrationEvidence : "Missing current evidence" },
    { key: "approval", label: "Approval", status: approval.valid ? "PASS" : "BLOCKED", detail: approval.valid ? "Approved for current payload" : version.approvals[0]?.approvedAt ? "Stale or incomplete approval" : "Pending" },
  ]; return { items, publishable: items.every((item) => item.status === "PASS"), payloadHash };
}
