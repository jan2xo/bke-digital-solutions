import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";

const versionId = process.argv[2];
const backupId = process.argv[3];
const output = process.argv[4] ?? join(".supply-chain", versionId ?? "unknown", "backup-certification.json");
if (!versionId || !backupId) throw new Error("Usage: npm run supplychain:backup-evidence -- <version-id> <backup-id> [output-file]");

const version = await db.productVersion.findUnique({ where: { id: versionId }, include: { product: true, artifacts: { where: { active: true, removedAt: null } } } });
if (!version) throw new Error("RELEASE_NOT_FOUND");
const payloadHash = manifestHash(canonicalizeManifest(buildReleaseManifest({ productId: version.productId, productSlug: version.product.slug, versionId: version.id, version: version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: version.artifacts.map((artifact) => ({ id: artifact.id, objectKey: artifact.objectKey, sha256: artifact.sha256, sizeBytes: Number(artifact.sizeBytes), contentType: artifact.contentType })) })));

const archive = await db.backupArchive.findUnique({ where: { id: backupId }, include: { operations: { orderBy: { createdAt: "asc" } } } });
if (!archive) throw new Error("BACKUP_NOT_FOUND");
if (archive.status !== "VERIFIED" || archive.missingObjectCount !== 0 || !archive.manifestObjectKey || !archive.databaseObjectKey || !archive.manifestChecksum || !archive.databaseChecksum) throw new Error("BACKUP_ARCHIVE_NOT_CERTIFIABLE");
const create = archive.operations.find((operation) => operation.type === "CREATE" && operation.backupId === backupId && operation.status === "SUCCEEDED");
const verify = archive.operations.find((operation) => operation.type === "VERIFY" && operation.backupId === backupId && operation.status === "SUCCEEDED");
const simulate = archive.operations.find((operation) => operation.type === "SIMULATE_RESTORE" && operation.backupId === backupId && operation.status === "SUCCEEDED");
if (!create) throw new Error("BACKUP_CREATE_NOT_SUCCEEDED");
if (!verify) throw new Error("BACKUP_VERIFY_NOT_SUCCEEDED");
if (!simulate) throw new Error("BACKUP_SIMULATE_RESTORE_NOT_SUCCEEDED");

const evidence = {
  format: "bke.backup-certification.v1",
  versionId: version.id,
  releaseVersion: version.version,
  backupId: archive.id,
  payloadBinding: payloadHash,
  createOperation: { id: create.id, type: create.type, status: create.status, createdAt: create.createdAt, completedAt: create.completedAt },
  verifyOperation: { id: verify.id, type: verify.type, status: verify.status, createdAt: verify.createdAt, completedAt: verify.completedAt },
  simulateRestoreOperation: { id: simulate.id, type: simulate.type, status: simulate.status, createdAt: simulate.createdAt, completedAt: simulate.completedAt },
  archive: { id: archive.id, status: archive.status, objectCount: archive.objectCount, missingObjectCount: archive.missingObjectCount, sizeBytes: archive.sizeBytes.toString(), manifestObjectKey: archive.manifestObjectKey, databaseObjectKey: archive.databaseObjectKey, manifestChecksum: archive.manifestChecksum, databaseChecksum: archive.databaseChecksum, createdAt: archive.createdAt, completedAt: archive.completedAt, verifiedAt: archive.verifiedAt },
  certifiedAt: new Date().toISOString(),
};
await mkdir(dirname(output), { recursive: true });
const serialized = JSON.stringify(evidence, null, 2) + "\n";
await writeFile(output, serialized, { mode: 0o600 });
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(serialized), sha256: createHash("sha256").update(serialized).digest("hex"), backupId, versionId }));
