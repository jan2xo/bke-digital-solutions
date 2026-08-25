import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { env } from "@/lib/env";
import { currentApproval } from "@/lib/releases/approval";
import { commissioningEvidenceDecision } from "@/lib/commissioning/types";
import { isCommercialComplianceEvidence } from "@/lib/supply-chain/compliance-certification";
import { evaluateSupplyChainSecurity } from "@/lib/supply-chain/controls";
export type ReadinessItem = { key: string; label: string; status: "PASS" | "PENDING" | "BLOCKED"; detail: string };
export function releaseReadiness(version: { id?: string; productId: string; version: string; product: { slug: string }; artifacts: Array<{ id: string; objectKey: string; sha256: string; sizeBytes: bigint; contentType: string }>; supplyChainEvidence: { signatureVerified: boolean; signatureKeyId: string | null; sbomReference: string | null; provenanceStatus: string; dependencyVerified: boolean; malwareStatus: string; certificateStatus?: string | null; verificationEvidence: Array<{ kind: string; result: string; artifactHash: string; metadata: unknown }> } | null; backupEvidence: string | null; complianceEvidence: string | null; migrationEvidence: string | null; approvals: Array<{ payloadHash?: string | null; approvedAt: Date | null; approvedById?: string | null; reviewedAt?: Date | null; reviewedById?: string | null; createdById?: string }> }, options: { complianceCurrent?: boolean; pendingComplianceCount?: number } = {}): { items: ReadinessItem[]; publishable: boolean; payloadHash: string } {
  const manifest = buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id ?? "", version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
  const payloadHash = manifestHash(canonicalizeManifest(manifest)); const evidence = version.supplyChainEvidence;
  const current = (kind: string, result: string) => evidence?.verificationEvidence.some((item) => item.kind === kind && item.result === result && item.artifactHash === payloadHash) ?? false;
  const currentEvent = (kind: string) => evidence?.verificationEvidence.find((item) => item.kind === kind && item.artifactHash === payloadHash);
  const technicalDecision = (kind: string) => {
    const item = currentEvent(kind);
    if (!item) return { accepted: false, detail: "Optional V2 evidence not recorded", commissioning: false };
    const decision = commissioningEvidenceDecision(kind, item.result, item.metadata);
    if (decision.recognized) return { accepted: decision.accepted, detail: decision.detail, commissioning: true };
    return { accepted: item.result === "VERIFIED", detail: item.result === "VERIFIED" ? "Verified" : `Evidence ${item.result}`, commissioning: false };
  };
  const cleanIds = new Set((evidence?.verificationEvidence ?? []).filter((item) => item.kind === "MALWARE_SCAN" && item.result === "CLEAN" && item.artifactHash === payloadHash).map((item) => typeof item.metadata === "object" && item.metadata && "artifactId" in item.metadata ? String((item.metadata as { artifactId: unknown }).artifactId) : ""));
  const malware = version.artifacts.length > 0 && cleanIds.size === version.artifacts.length && version.artifacts.every((a) => cleanIds.has(a.id));
  const complianceCurrent = (options.complianceCurrent ?? true) && (evidence?.verificationEvidence.some((item) => isCommercialComplianceEvidence(item, version.id ?? "", payloadHash)) ?? false);
  const supplyChainSafe = evaluateSupplyChainSecurity({ currentHash: payloadHash, artifacts: version.artifacts, evidence: evidence?.verificationEvidence ?? [], certificateStatus: evidence?.certificateStatus, malwareStatus: evidence?.malwareStatus }).releasable;
  const approval = currentApproval(version.approvals, payloadHash);
  const sbom = technicalDecision("SBOM"); const provenance = technicalDecision("PROVENANCE"); const dependencies = technicalDecision("DEPENDENCIES"); const migration = technicalDecision("MIGRATION");
  const optional = (passed: boolean): "PASS" | "PENDING" => passed ? "PASS" : "PENDING";
  const items: ReadinessItem[] = [
    { key: "signature", label: "Signature", status: current("SIGNATURE", "VERIFIED") ? "PASS" : "BLOCKED", detail: evidence?.signatureKeyId ?? "Missing current signature" },
    { key: "malware", label: "Malware", status: malware ? "PASS" : "BLOCKED", detail: malware ? "All current artifacts CLEAN" : evidence?.malwareStatus ?? "Missing current evidence" },
    { key: "sbom", label: "SBOM (V2 evidence)", status: optional(sbom.accepted && Boolean(evidence?.sbomReference)), detail: sbom.accepted ? `${evidence?.sbomReference ?? "Evidence recorded"} — ${sbom.detail}` : sbom.detail },
    { key: "provenance", label: "Provenance (V2 evidence)", status: optional(provenance.accepted && evidence?.provenanceStatus === "VERIFIED"), detail: provenance.accepted ? provenance.detail : "Optional V2 evidence not recorded" },
    { key: "dependencies", label: "Dependencies (V2 evidence)", status: optional(dependencies.commissioning ? dependencies.accepted : evidence?.dependencyVerified === true && dependencies.accepted), detail: dependencies.detail },
    { key: "backup", label: "Backup (V2 evidence)", status: optional(Boolean(version.backupEvidence) && current("BACKUP", "VERIFIED")), detail: version.backupEvidence && current("BACKUP", "VERIFIED") ? version.backupEvidence : "Optional V2 evidence not recorded" },
    { key: "compliance", label: "Compliance (V2 evidence)", status: optional(Boolean(version.complianceEvidence) && complianceCurrent), detail: version.complianceEvidence && complianceCurrent ? version.complianceEvidence : "Optional V2 evidence not recorded" },
    { key: "migration", label: "Migration (V2 evidence)", status: optional(Boolean(version.migrationEvidence) && migration.accepted), detail: migration.accepted ? `${version.migrationEvidence ?? "Evidence recorded"} — ${migration.detail}` : migration.detail },
    { key: "approval", label: "Approval", status: approval.valid ? "PASS" : "BLOCKED", detail: approval.valid ? "Approved for current payload" : version.approvals[0]?.approvedAt ? "Stale or incomplete approval" : "Pending" },
    { key: "compliance-register", label: "Compliance register (V2 evidence)", status: optional((options.pendingComplianceCount ?? 0) === 0), detail: (options.pendingComplianceCount ?? 0) === 0 ? "All requirements implemented" : `${options.pendingComplianceCount} requirement(s) pending; non-blocking in V1` },
    { key: "supply-chain-safety", label: "Supply-chain safety", status: supplyChainSafe ? "PASS" : "BLOCKED", detail: supplyChainSafe ? "Integrity and scanner safety checks pass" : "Integrity/scanner safety checks incomplete" },
  ];
  const blockingKeys = new Set(["signature", "malware", "approval", "supply-chain-safety"]);
  return { items, publishable: items.filter((item) => blockingKeys.has(item.key)).every((item) => item.status === "PASS"), payloadHash };
}
