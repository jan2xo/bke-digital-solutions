import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { db } from "@/lib/db";
import { buildBackupCertificationDocument } from "@/lib/supply-chain/backup-certification";

const versionId = process.argv[2];
const backupId = process.argv[3];
const output = process.argv[4] ?? join(".supply-chain", versionId ?? "unknown", "backup-certification.json");
if (!versionId || !backupId) throw new Error("Usage: npm run supplychain:backup-evidence -- <version-id> <backup-id> [output-file]");

const version = await db.productVersion.findUnique({ where: { id: versionId }, include: { product: true, artifacts: { where: { active: true, removedAt: null } } } });
if (!version) throw new Error("RELEASE_NOT_FOUND");
const archive = await db.backupArchive.findUnique({ where: { id: backupId }, include: { operations: { orderBy: { createdAt: "asc" } } } });
const { serialized, documentSha256, payloadBinding } = buildBackupCertificationDocument(version, archive);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, serialized, { mode: 0o600 });
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(serialized), sha256: documentSha256, backupId, versionId, payloadBinding }));
