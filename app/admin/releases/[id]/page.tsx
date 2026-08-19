import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { releaseReadiness } from "@/lib/supply-chain/readiness";
import { ReleaseArtifactControls } from "@/components/release-artifact-controls";
import { AdminActionButton } from "@/components/admin-action-button";
import { ReleaseEvidenceControls } from "@/components/release-evidence-controls";
import { CHECKOUT_LEGAL_TYPES, SUBSCRIPTION_LEGAL_TYPES, REGISTRATION_LEGAL_TYPES } from "@/lib/legal/constants";
import { complianceLegalReferencesCurrent, isCommercialComplianceEvidence } from "@/lib/supply-chain/compliance-certification";

export default async function ReleaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const versionId = (await params).id;
  const [version, backups, pendingComplianceCount] = await Promise.all([
    db.productVersion.findUnique({ where: { id: versionId }, include: { product: { include: { editions: { include: { purchasePlans: { where: { active: true }, select: { type: true } } } } } }, artifacts: true, approvals: { orderBy: { createdAt: "desc" }, take: 50 }, supplyChainEvidence: { include: { verificationEvidence: true } } } }),
    db.backupArchive.findMany({ where: { status: "VERIFIED" }, select: { id: true, verifiedAt: true }, orderBy: { verifiedAt: "desc" }, take: 25 }),
    db.complianceRequirement.count({ where: { status: { not: "IMPLEMENTED" } } }),
  ]);
  if (!version) notFound();
  const requiredTypes = [...REGISTRATION_LEGAL_TYPES, ...CHECKOUT_LEGAL_TYPES, ...(version.product.editions.some((edition) => edition.purchasePlans.some((plan) => plan.type === "MONTHLY" || plan.type === "ANNUAL")) ? SUBSCRIPTION_LEGAL_TYPES : [])];
  const legalDocuments = await db.legalDocument.findMany({ where: { status: "ACTIVE", documentType: { in: requiredTypes }, currentPublishedVersionId: { not: null } }, include: { currentPublishedVersion: true } });
  const currentLegal = legalDocuments.flatMap((document) => document.currentPublishedVersion?.status === "PUBLISHED" ? [{ type: document.documentType, versionId: document.currentPublishedVersion.id, contentHash: document.currentPublishedVersion.contentHash }] : []);
  const payloadHash = releaseReadiness(version).payloadHash;
  const complianceEvidence = version.supplyChainEvidence?.verificationEvidence.find((item) => isCommercialComplianceEvidence(item, version.id, payloadHash));
  const complianceCurrent = legalDocuments.length === new Set(requiredTypes).size && !!complianceEvidence && complianceLegalReferencesCurrent(complianceEvidence.metadata, currentLegal);
  const readiness = releaseReadiness(version, { complianceCurrent, pendingComplianceCount });
  const objectiveReady = readiness.items.filter((item) => item.key !== "approval").every((item) => item.status === "PASS");
  const currentApproval = version.approvals.find((approval) => approval.payloadHash === readiness.payloadHash);
  const blocked = readiness.items.filter((item) => item.status !== "PASS" && ["sbom", "provenance", "dependencies", "backup", "compliance", "migration"].includes(item.key)).map((item) => item.key.toUpperCase() as "SBOM" | "PROVENANCE" | "DEPENDENCIES" | "BACKUP" | "COMPLIANCE" | "MIGRATION");
  return <main className="shell py-10">
    <Link href="/admin/releases" className="text-sm font-bold text-[#3D75A7]">← Release center</Link>
    <h1 className="mt-3 text-4xl font-black">{version.product.name} {version.version}</h1>
    <p className="mt-2 text-slate-600">{version.lifecycle} · {version.operatingSystem} {version.architecture} · current payload {readiness.payloadHash.slice(0, 16)}…</p>
    <section className="card mt-8 p-6"><h2 className="text-2xl font-black">Release readiness</h2>
      <div className="mt-4 grid gap-2 md:grid-cols-2">{readiness.items.map((item) => <div className="flex items-center justify-between rounded border p-3" key={item.key}><span className="font-bold">{item.label}</span><span className={item.status === "PASS" ? "text-green-700" : "text-red-700"}>{item.status} · {item.detail}</span></div>)}</div>
      <p className="mt-4 font-black">PUBLISH: <span className={readiness.publishable ? "text-green-700" : "text-red-700"}>{readiness.publishable ? "AVAILABLE" : "BLOCKED"}</span></p>
      <div className="mt-4 flex flex-wrap gap-2">{objectiveReady && !currentApproval?.reviewedAt && <AdminActionButton url={`/api/admin/versions/${version.id}`} label="Review Release" body={{ reviewed: true }} confirmText="Record your review of this current release payload?"/>}{objectiveReady && currentApproval?.reviewedAt && !currentApproval.approvedAt && <AdminActionButton url={`/api/admin/versions/${version.id}`} label="Approve Release" body={{ approve: true }} confirmText="Approve this current release payload?"/>}{readiness.publishable && ["STABLE", "LTS"].includes(version.lifecycle) && <AdminActionButton url={`/api/admin/versions/${version.id}`} label="Publish Release" body={{ lifecycle: version.lifecycle, approve: true, published: true }} confirmText="Publish this approved release?"/>}</div>
      <ReleaseEvidenceControls versionId={version.id} blocked={blocked} backupOptions={backups.map((backup) => ({ id: backup.id, verifiedAt: backup.verifiedAt?.toISOString() ?? null }))}/>
    </section>
    <section className="card mt-8 p-6"><h2 className="text-2xl font-black">Artifacts</h2><div className="mt-4 grid gap-3">{version.artifacts.map((artifact) => <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3" key={artifact.id}><span><strong>{artifact.name}</strong><br/><code className="text-xs">{artifact.sha256}</code></span><ReleaseArtifactControls artifactId={artifact.id} active={artifact.active}/></div>)}</div><ReleaseArtifactControls versionId={version.id}/></section>
    <section className="card mt-8 p-6"><h2 className="text-2xl font-black">Evidence</h2><div className="mt-4 grid gap-2 text-sm">{version.supplyChainEvidence?.verificationEvidence.map((item) => <div className="rounded border p-3" key={item.id}><strong>{item.kind}</strong> · {item.result} · {item.artifactHash.slice(0, 16)}… · {item.verifiedAt.toLocaleString()} {item.failureReason ? `· ${item.failureReason}` : ""}</div>) ?? <p>Evidence pending.</p>}</div></section>
    <div className="mt-6 flex gap-2"><AdminActionButton url="/api/admin/supply-chain" method="POST" label="Scan / rescan" body={{ versionId: version.id, action: "RECORD_SCAN" }}/><AdminActionButton url="/api/admin/supply-chain" method="POST" label="Sign" body={{ versionId: version.id, action: "SIGN" }} confirmText="Sign the current release manifest?"/><AdminActionButton url={`/api/admin/versions/${version.id}`} label="Promote" body={{ lifecycle: version.lifecycle === "DRAFT" ? "INTERNAL" : version.lifecycle === "INTERNAL" ? "ALPHA" : version.lifecycle === "ALPHA" ? "BETA" : version.lifecycle === "BETA" ? "RELEASE_CANDIDATE" : "STABLE", approve: version.lifecycle === "RELEASE_CANDIDATE" }} confirmText="Promote this release?"/></div>
  </main>;
}
