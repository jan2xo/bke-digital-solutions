import { createHash } from "node:crypto";
import { env } from "@/lib/env";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";

type CertificationArtifact = { id: string; objectKey: string; sha256: string; sizeBytes: bigint | number; contentType: string; active?: boolean; removedAt?: Date | null };
type CertificationVersion = { id: string; productId: string; version: string; product: { slug: string }; artifacts: CertificationArtifact[] };
type CertificationOperation = { id: string; backupId: string | null; type: string; status: string; createdAt: Date; completedAt: Date | null };
type CertificationArchive = { id: string; status: string; missingObjectCount: number; manifestObjectKey: string | null; databaseObjectKey: string | null; manifestChecksum: string | null; databaseChecksum: string | null; objectCount: number; sizeBytes: bigint | number; createdAt: Date; completedAt: Date | null; verifiedAt: Date | null; operations: CertificationOperation[] };

export function buildBackupCertificationDocument(version: CertificationVersion, archive: CertificationArchive | null) {
  if (!version) throw new Error("RELEASE_NOT_FOUND");
  if (!archive) throw new Error("BACKUP_NOT_FOUND");
  if (archive.status !== "VERIFIED" || archive.missingObjectCount !== 0 || !archive.manifestObjectKey || !archive.databaseObjectKey || !archive.manifestChecksum || !archive.databaseChecksum) throw new Error("BACKUP_ARCHIVE_NOT_CERTIFIABLE");
  const payloadBinding = manifestHash(canonicalizeManifest(buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id, version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.filter((artifact) => artifact.active !== false && !artifact.removedAt).map((artifact) => ({ id: artifact.id, objectKey: artifact.objectKey, sha256: artifact.sha256, sizeBytes: Number(artifact.sizeBytes), contentType: artifact.contentType })) })));
  const create = archive.operations.find((operation) => operation.type === "CREATE" && operation.backupId === archive.id && operation.status === "SUCCEEDED");
  const verify = archive.operations.find((operation) => operation.type === "VERIFY" && operation.backupId === archive.id && operation.status === "SUCCEEDED");
  const simulate = archive.operations.find((operation) => operation.type === "SIMULATE_RESTORE" && operation.backupId === archive.id && operation.status === "SUCCEEDED");
  if (!create) throw new Error("BACKUP_CREATE_NOT_SUCCEEDED");
  if (!verify) throw new Error("BACKUP_VERIFY_NOT_SUCCEEDED");
  if (!simulate) throw new Error("BACKUP_SIMULATE_RESTORE_NOT_SUCCEEDED");
  const evidence = { format: "bke.backup-certification.v1", versionId: version.id, releaseVersion: version.version, backupId: archive.id, payloadBinding, createOperation: { id: create.id, type: create.type, status: create.status, createdAt: create.createdAt, completedAt: create.completedAt }, verifyOperation: { id: verify.id, type: verify.type, status: verify.status, createdAt: verify.createdAt, completedAt: verify.completedAt }, simulateRestoreOperation: { id: simulate.id, type: simulate.type, status: simulate.status, createdAt: simulate.createdAt, completedAt: simulate.completedAt }, archive: { id: archive.id, status: archive.status, objectCount: archive.objectCount, missingObjectCount: archive.missingObjectCount, sizeBytes: archive.sizeBytes.toString(), manifestObjectKey: archive.manifestObjectKey, databaseObjectKey: archive.databaseObjectKey, manifestChecksum: archive.manifestChecksum, databaseChecksum: archive.databaseChecksum, createdAt: archive.createdAt, completedAt: archive.completedAt, verifiedAt: archive.verifiedAt }, certifiedAt: new Date().toISOString() };
  const serialized = JSON.stringify(evidence, null, 2) + "\n";
  return { evidence, serialized, documentSha256: createHash("sha256").update(serialized).digest("hex"), payloadBinding };
}

/** Select a backup only when the current release has exactly one fully verified candidate. */
export function selectUniqueVerifiedBackup<T extends CertificationArchive>(version: CertificationVersion, candidates: T[]): T {
  const eligible = candidates.filter((candidate) => {
    try {
      buildBackupCertificationDocument(version, candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (eligible.length === 0) throw new Error("NO_UNAMBIGUOUS_VERIFIED_BACKUP");
  if (eligible.length > 1) throw new Error("AMBIGUOUS_VERIFIED_BACKUP");
  return eligible[0];
}
