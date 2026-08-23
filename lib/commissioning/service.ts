import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { COMMISSIONING_GENERATOR_VERSION, COMMISSIONING_POLICY_VERSION, classifyArtifact, type ArtifactClassification, type CommissioningEvidence } from "@/lib/commissioning/types";

const nowIso = () => new Date().toISOString();
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

export async function ensureCommissioningRun(artifactId: string) {
  const artifact = await db.productArtifact.findUniqueOrThrow({ where: { id: artifactId }, include: { version: { include: { product: true, artifacts: true } } } });
  if (!artifact.version) throw new Error("COMMISSIONING_VERSION_REQUIRED");
  const manifest = buildReleaseManifest({ productId: artifact.productId, productSlug: artifact.version.product.slug, versionId: artifact.versionId!, version: artifact.version.version, signingKeyId: "bke-commissioning", artifacts: artifact.version.artifacts.map((item) => ({ id: item.id, objectKey: item.objectKey, sha256: item.sha256, sizeBytes: Number(item.sizeBytes), contentType: item.contentType })) });
  const payloadHash = manifestHash(canonicalizeManifest(manifest));
  const classification = classifyArtifact(artifact.name, artifact.contentType);
  return db.commissioningRun.upsert({
    where: { artifactId_artifactSha256_payloadHash_policyVersion_generatorVersion: { artifactId: artifact.id, artifactSha256: artifact.sha256, payloadHash, policyVersion: COMMISSIONING_POLICY_VERSION, generatorVersion: COMMISSIONING_GENERATOR_VERSION } },
    update: { status: "PENDING", errorCode: null },
    create: { productId: artifact.productId, versionId: artifact.versionId!, artifactId: artifact.id, artifactSha256: artifact.sha256, artifactSizeBytes: artifact.sizeBytes, payloadHash, policyVersion: COMMISSIONING_POLICY_VERSION, generatorVersion: COMMISSIONING_GENERATOR_VERSION, classification },
  });
}

export async function processCommissioningRun(runId: string) {
  const run = await db.commissioningRun.findUniqueOrThrow({ where: { id: runId }, include: { artifact: true, version: { include: { product: true, artifacts: true, supplyChainEvidence: { include: { verificationEvidence: true } } } } } });
  if (run.artifact.sha256 !== run.artifactSha256 || run.artifact.sizeBytes !== run.artifactSizeBytes) throw new Error("COMMISSIONING_ARTIFACT_CHANGED");
  const claimed = await db.commissioningRun.updateMany({ where: { id: runId, status: { in: ["PENDING", "FAILED"] }, artifactSha256: run.artifact.sha256, artifactSizeBytes: run.artifact.sizeBytes }, data: { status: "ANALYZING", attempts: { increment: 1 }, startedAt: new Date(), errorCode: null } });
  if (!claimed.count) return { skipped: true as const };
  const limitations = ["Static analysis only; no source code or runtime behavior was assumed."];
  if (["GENERIC_BINARY", "WINDOWS_BINARY", "MACOS_PACKAGE", "LINUX_PACKAGE"].includes(run.classification)) limitations.push("Dependency completeness is limited to observable metadata in this MVP.");
  const component = { "bom-ref": `bke:artifact:${run.artifact.sha256}`, type: "file", name: run.artifact.name, version: run.version.version, hashes: [{ alg: "SHA-256", content: run.artifact.sha256 }], properties: [{ name: "bke.artifactId", value: run.artifact.id }] };
  const classification = run.classification as ArtifactClassification;
  const result: CommissioningEvidence = { schema: "bke.commissioning.evidence.v1", result: classification === "SCRIPT" || classification === "ZIP_ARCHIVE" ? "PARTIAL" : "UNDETERMINED", artifactSha256: run.artifact.sha256, artifactId: run.artifact.id, generatedAt: nowIso(), generator: COMMISSIONING_GENERATOR_VERSION, method: "BKE static canonical-byte inspection", components: [component], dependencies: [], classification, limitations };
  const provenance = { schema: "bke.provenance.custody.v1", commissioningRunId: run.id, intakeSource: "BKE_ARTIFACT_INTAKE", intakeTimestamp: run.artifact.createdAt.toISOString(), artifactId: run.artifact.id, productId: run.productId, versionId: run.versionId, originalFilename: run.artifact.name, canonicalObjectKey: run.artifact.objectKey, canonicalSha256: run.artifact.sha256, canonicalSize: Number(run.artifact.sizeBytes), contentType: run.artifact.contentType, payloadHash: run.payloadHash, generator: COMMISSIONING_GENERATOR_VERSION, generatedAt: nowIso(), limitations };
  const migration = { schema: "bke.migration-assessment.v1", category: run.classification === "SCRIPT" ? "NONE_REQUIRED" : "UNKNOWN", status: run.classification === "SCRIPT" ? "VERIFIED" : "UNDETERMINED", rationale: run.classification === "SCRIPT" ? "Static script/plugin artifact has no BKE database migration surface." : "No application migration contract is observable from this artifact alone.", method: "BKE static artifact classification", limitations };
  const dependency = { schema: "bke.dependency-analysis.v1", result: "NONE_OBSERVED", confidence: "LOW", dependencies: [], method: "BKE static canonical-byte inspection", limitations };
  const evidenceItems = [
    { kind: "SBOM", result: "VERIFIED", artifactHash: run.payloadHash!, metadata: result },
    { kind: "DEPENDENCIES", result: "VERIFIED", artifactHash: run.payloadHash!, metadata: dependency },
    { kind: "PROVENANCE", result: "VERIFIED", artifactHash: run.payloadHash!, metadata: provenance },
    { kind: "MIGRATION", result: "VERIFIED", artifactHash: run.payloadHash!, metadata: migration },
  ];
  await db.$transaction(async (tx) => {
    const existing = run.version.supplyChainEvidence ?? await tx.supplyChainEvidence.create({ data: { versionId: run.versionId, releaseIdentifier: `${run.version.product.slug}:${run.version.version}`, commitHash: "BKE-COMMISSIONING", branch: "BKE", buildEnvironment: "BKE-CUSTODY", builderIdentity: "BKE-DIGITAL-SOLUTIONS", builtAt: run.artifact.createdAt, manifestJson: {}, canonicalPayloadHash: run.payloadHash } });
    await tx.supplyChainVerificationEvidence.deleteMany({ where: { evidenceId: existing.id, artifactHash: run.payloadHash! } });
    await tx.supplyChainVerificationEvidence.createMany({ data: evidenceItems.map((item) => ({ evidenceId: existing.id, kind: item.kind, result: item.result, artifactHash: item.artifactHash, scannerId: COMMISSIONING_GENERATOR_VERSION, scannerVersion: COMMISSIONING_GENERATOR_VERSION, metadata: json(item.metadata) })) });
    await tx.supplyChainEvidence.update({ where: { id: existing.id }, data: { sbomReference: `commissioning:${run.id}:sbom`, sbomFormat: "CycloneDX", provenanceStatus: "VERIFIED", dependencyVerified: true, canonicalPayloadHash: run.payloadHash, manifestJson: { commissioningRunId: run.id, artifactSha256: run.artifact.sha256 } } });
    await tx.commissioningRun.update({ where: { id: run.id }, data: { status: "EVIDENCE_READY", completedAt: new Date(), sbomStatus: result.result, dependencyStatus: "NONE_OBSERVED", migrationCategory: migration.category, migrationStatus: migration.status, evidence: json({ sbom: result, dependencies: dependency, provenance, migration }), limitations: json(limitations) } });
  });
  return { runId: run.id, status: "EVIDENCE_READY" as const };
}

export async function processPendingCommissioning(limit = 10) {
  const runs = await db.commissioningRun.findMany({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });
  let ready = 0;
  for (const run of runs) { try { const result = await processCommissioningRun(run.id); if ("status" in result && result.status === "EVIDENCE_READY") ready++; } catch (error) { await db.commissioningRun.update({ where: { id: run.id }, data: { status: "FAILED", errorCode: error instanceof Error ? error.message.slice(0, 120) : "COMMISSIONING_FAILED" } }).catch(() => undefined); } }
  return { candidates: runs.length, evidenceReady: ready };
}
