import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { backupManifestSchema, canonicalJson, decryptBuffer, encryptBuffer, missingObjects, sha256, verifyManifest, type BackupManifest } from "@/lib/backups/integrity";
import { retryAt } from "@/lib/backups/policy";
import type { BackupOperation } from "@/generated/prisma/client";

const exec = promisify(execFile);

function sourceClient() {
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw new Error("SOURCE_STORAGE_NOT_CONFIGURED");
  return new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: env.S3_FORCE_PATH_STYLE, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
}

function backupClient() {
  if (!env.BACKUP_S3_ACCESS_KEY_ID || !env.BACKUP_S3_SECRET_ACCESS_KEY || !env.BACKUP_BUCKET) throw new Error("BACKUP_STORAGE_NOT_CONFIGURED");
  return new S3Client({ region: env.BACKUP_S3_REGION, endpoint: env.BACKUP_S3_ENDPOINT, forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE, credentials: { accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY } });
}

function encryptionKey() {
  if (!env.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_NOT_CONFIGURED");
  const key = Buffer.from(env.BACKUP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("INVALID_BACKUP_ENCRYPTION_KEY");
  return key;
}

function pgEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") ?? undefined };
}

async function allObjectKeys(client: S3Client, bucket: string, prefix?: string) {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    keys.push(...(page.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []));
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return keys.sort();
}

async function getBytes(client: S3Client, bucket: string, key: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("BACKUP_OBJECT_MISSING");
  return Buffer.from(await result.Body.transformToByteArray());
}

async function tableCounts() {
  const [users, orders, payments, invoices, licenses, subscriptions, legalAcceptances, audits, scheduledRuns] = await Promise.all([
    db.user.count(), db.order.count(), db.payment.count(), db.invoice.count(), db.license.count(), db.subscription.count(), db.legalAcceptance.count(), db.auditLog.count(), db.scheduledJobRun.count(),
  ]);
  return { users, orders, payments, invoices, licenses, subscriptions, legalAcceptances, audits, scheduledRuns };
}

async function createArchive(operation: BackupOperation & { backup: NonNullable<unknown> }) {
  const backup = await db.backupArchive.findUniqueOrThrow({ where: { id: operation.backupId! } });
  if (operation.dryRun) {
    const [artifactKeys, imageKeys, objectKeys] = await Promise.all([
      db.productArtifact.findMany({ select: { objectKey: true } }),
      db.product.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } }),
      allObjectKeys(sourceClient(), env.S3_BUCKET),
    ]);
    const expected = [...artifactKeys.map((item) => item.objectKey), ...imageKeys.flatMap((item) => item.imageKey ? [item.imageKey] : [])];
    return { dryRun: true, sourceObjects: objectKeys.length, missingSourceObjects: missingObjects(expected, objectKeys).length };
  }
  if (!env.BACKUP_ENABLED) throw new Error("BACKUPS_DISABLED");
  const startedAt = new Date();
  await db.backupArchive.update({ where: { id: backup.id }, data: { status: "CREATING", startedAt } });
  const work = await mkdtemp(join(tmpdir(), "bke-backup-"));
  try {
    await chmod(work, 0o700);
    const dumpPath = join(work, "database.dump");
    await exec("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-acl", "--file", dumpPath], { env: pgEnvironment(env.DATABASE_URL), maxBuffer: 1024 * 1024 });
    const dump = await readFile(dumpPath);
    const encryptedDatabase = encryptBuffer(dump, encryptionKey());
    const databaseKey = `${backup.storagePrefix}/database.dump.enc`;
    await backupClient().send(new PutObjectCommand({ Bucket: env.BACKUP_BUCKET!, Key: databaseKey, Body: encryptedDatabase.encrypted, ContentType: "application/octet-stream" }));

    const source = sourceClient();
    const destination = backupClient();
    const objectKeys = await allObjectKeys(source, env.S3_BUCKET);
    const artifacts = await db.productArtifact.findMany({ select: { objectKey: true } });
    const images = await db.product.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } });
    const expected = [...artifacts.map((item) => item.objectKey), ...images.flatMap((item) => item.imageKey ? [item.imageKey] : [])];
    const absent = missingObjects(expected, objectKeys);
    const backedObjects: BackupManifest["objects"] = [];
    for (const sourceKey of objectKeys) {
      const bytes = await getBytes(source, env.S3_BUCKET, sourceKey);
      const encrypted = encryptBuffer(bytes, encryptionKey());
      const backupKey = `${backup.storagePrefix}/objects/${Buffer.from(sourceKey).toString("base64url")}.enc`;
      await destination.send(new PutObjectCommand({ Bucket: env.BACKUP_BUCKET!, Key: backupKey, Body: encrypted.encrypted, ContentType: "application/octet-stream" }));
      backedObjects.push({ sourceKey, backupKey, sizeBytes: bytes.length, encryptedSizeBytes: encrypted.encrypted.length, sha256: sha256(bytes), encryptedSha256: sha256(encrypted.encrypted), iv: encrypted.iv, authTag: encrypted.authTag });
    }
    const migrations = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL ORDER BY "finished_at"`;
    const manifest: BackupManifest = {
      formatVersion: 1,
      backupId: backup.id,
      deploymentId: env.DEPLOYMENT_ID,
      createdAt: new Date().toISOString(),
      retentionTier: backup.retentionTier,
      database: { sourceKey: "postgresql", backupKey: databaseKey, sizeBytes: dump.length, encryptedSizeBytes: encryptedDatabase.encrypted.length, sha256: sha256(dump), encryptedSha256: sha256(encryptedDatabase.encrypted), iv: encryptedDatabase.iv, authTag: encryptedDatabase.authTag },
      objects: backedObjects,
      missingSourceObjects: absent,
      migrations: migrations.map((item) => item.migration_name),
      tableCounts: await tableCounts(),
      runtime: { nodeVersion: process.version, paymentProvider: env.PAYMENT_PROVIDER, emailProvider: env.EMAIL_PROVIDER, providerConfigSource: env.PROVIDER_CONFIG_SOURCE, sourceBucket: env.S3_BUCKET },
    };
    backupManifestSchema.parse(manifest);
    const serialized = canonicalJson(manifest);
    const manifestKey = `${backup.storagePrefix}/manifest.json`;
    await destination.send(new PutObjectCommand({ Bucket: env.BACKUP_BUCKET!, Key: manifestKey, Body: serialized, ContentType: "application/json" }));
    const completedAt = new Date();
    const sizeBytes = BigInt(encryptedDatabase.encrypted.length + backedObjects.reduce((total, item) => total + item.encryptedSizeBytes, 0) + Buffer.byteLength(serialized));
    await db.backupArchive.update({ where: { id: backup.id }, data: { status: absent.length ? "INCOMPLETE" : "AVAILABLE", manifestObjectKey: manifestKey, manifestChecksum: sha256(serialized), databaseObjectKey: databaseKey, databaseChecksum: manifest.database.sha256, encryptedChecksum: manifest.database.encryptedSha256, encryptionKeyVersion: env.BACKUP_ENCRYPTION_KEY_VERSION, objectCount: backedObjects.length, missingObjectCount: absent.length, sizeBytes, completedAt, durationMs: completedAt.getTime() - startedAt.getTime(), errorCode: absent.length ? "SOURCE_OBJECTS_MISSING" : null } });
    if (absent.length) throw new Error("SOURCE_OBJECTS_MISSING");
    return { backupId: backup.id, objects: backedObjects.length, sizeBytes: sizeBytes.toString(), manifestChecksum: sha256(serialized) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function loadManifest(backupId: string) {
  const backup = await db.backupArchive.findUniqueOrThrow({ where: { id: backupId } });
  if (!backup.manifestObjectKey || !backup.manifestChecksum || !env.BACKUP_BUCKET) throw new Error("BACKUP_MANIFEST_UNAVAILABLE");
  const bytes = await getBytes(backupClient(), env.BACKUP_BUCKET, backup.manifestObjectKey);
  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  const verified = verifyManifest(parsed, backup.manifestChecksum);
  if (!verified.checksumMatches) throw new Error("MANIFEST_CHECKSUM_MISMATCH");
  return { backup, manifest: verified.manifest };
}

async function verifyArchive(backupId: string, simulateRestore: boolean) {
  const { backup, manifest } = await loadManifest(backupId);
  if (manifest.missingSourceObjects.length) throw new Error("SOURCE_OBJECTS_MISSING");
  const objects = [manifest.database, ...manifest.objects];
  for (const object of objects) {
    const encrypted = await getBytes(backupClient(), env.BACKUP_BUCKET!, object.backupKey);
    if (sha256(encrypted) !== object.encryptedSha256) throw new Error("BACKUP_CIPHERTEXT_CORRUPT");
    if (simulateRestore) {
      const plaintext = decryptBuffer(encrypted, encryptionKey(), object.iv, object.authTag);
      if (sha256(plaintext) !== object.sha256) throw new Error("BACKUP_PLAINTEXT_CORRUPT");
    }
  }
  if (simulateRestore) {
    const work = await mkdtemp(join(tmpdir(), "bke-restore-simulation-"));
    try {
      await chmod(work, 0o700);
      const encrypted = await getBytes(backupClient(), env.BACKUP_BUCKET!, manifest.database.backupKey);
      const dump = decryptBuffer(encrypted, encryptionKey(), manifest.database.iv, manifest.database.authTag);
      const dumpPath = join(work, "database.dump");
      await writeFile(dumpPath, dump, { mode: 0o600 });
      await exec("pg_restore", ["--list", dumpPath], { maxBuffer: 8 * 1024 * 1024 });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  await db.backupArchive.update({ where: { id: backup.id }, data: { status: "VERIFIED", verifiedAt: new Date(), errorCode: null } });
  return { backupId, objects: manifest.objects.length, databaseVerified: true, restoreSimulation: simulateRestore };
}

async function restoreIsolated(backupId: string) {
  if (env.BACKUP_RESTORE_ACK !== "ISOLATED_TARGET_ONLY" || !env.BACKUP_RESTORE_DATABASE_URL || !env.BACKUP_RESTORE_S3_BUCKET) throw new Error("ISOLATED_RESTORE_NOT_CONFIGURED");
  const sourceFingerprint = sha256(new URL(env.DATABASE_URL).host + new URL(env.DATABASE_URL).pathname);
  const targetFingerprint = sha256(new URL(env.BACKUP_RESTORE_DATABASE_URL).host + new URL(env.BACKUP_RESTORE_DATABASE_URL).pathname);
  if (sourceFingerprint === targetFingerprint) throw new Error("RESTORE_TARGET_NOT_ISOLATED");
  const { manifest } = await loadManifest(backupId);
  const work = await mkdtemp(join(tmpdir(), "bke-restore-"));
  try {
    await chmod(work, 0o700);
    const encrypted = await getBytes(backupClient(), env.BACKUP_BUCKET!, manifest.database.backupKey);
    const dump = decryptBuffer(encrypted, encryptionKey(), manifest.database.iv, manifest.database.authTag);
    if (sha256(dump) !== manifest.database.sha256) throw new Error("RESTORE_DATABASE_CHECKSUM_MISMATCH");
    const dumpPath = join(work, "database.dump");
    await writeFile(dumpPath, dump, { mode: 0o600 });
    await exec("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", new URL(env.BACKUP_RESTORE_DATABASE_URL).pathname.slice(1), dumpPath], { env: pgEnvironment(env.BACKUP_RESTORE_DATABASE_URL), maxBuffer: 1024 * 1024 });
    const target = backupClient();
    for (const object of manifest.objects) {
      const cipherText = await getBytes(backupClient(), env.BACKUP_BUCKET!, object.backupKey);
      const plainText = decryptBuffer(cipherText, encryptionKey(), object.iv, object.authTag);
      if (sha256(plainText) !== object.sha256) throw new Error("RESTORE_OBJECT_CHECKSUM_MISMATCH");
      await target.send(new PutObjectCommand({ Bucket: env.BACKUP_RESTORE_S3_BUCKET, Key: object.sourceKey, Body: plainText }));
    }
    return { backupId, targetFingerprint, restoredObjects: manifest.objects.length, isolated: true };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function deleteExpired(backupId: string) {
  const backup = await db.backupArchive.findUniqueOrThrow({ where: { id: backupId } });
  if (!backup.expiresAt || backup.expiresAt > new Date()) throw new Error("BACKUP_NOT_EXPIRED");
  const keys = await allObjectKeys(backupClient(), env.BACKUP_BUCKET!, `${backup.storagePrefix}/`);
  for (const key of keys) await backupClient().send(new DeleteObjectCommand({ Bucket: env.BACKUP_BUCKET!, Key: key }));
  await db.backupArchive.update({ where: { id: backup.id }, data: { status: "DELETED", deletedAt: new Date() } });
  return { backupId, deletedObjects: keys.length };
}

export async function executeBackupOperation(operation: BackupOperation) {
  const started = Date.now();
  try {
    let summary: Record<string, unknown>;
    if (operation.type === "CREATE") summary = await createArchive(operation as BackupOperation & { backup: NonNullable<unknown> });
    else if (!operation.backupId) throw new Error("BACKUP_OPERATION_MISSING_ARCHIVE");
    else if (operation.type === "VERIFY") summary = await verifyArchive(operation.backupId, false);
    else if (operation.type === "SIMULATE_RESTORE") summary = await verifyArchive(operation.backupId, true);
    else if (operation.type === "RESTORE_ISOLATED") summary = await restoreIsolated(operation.backupId);
    else summary = await deleteExpired(operation.backupId);
    await db.backupOperation.update({ where: { id: operation.id }, data: { status: "SUCCEEDED", completedAt: new Date(), durationMs: Date.now() - started, resultSummary: summary as object, targetFingerprint: typeof summary.targetFingerprint === "string" ? summary.targetFingerprint : undefined, claimedBy: null } });
    await audit({ actorId: operation.requestedById ?? undefined, action: `BACKUP_${operation.type}_SUCCEEDED`, targetType: "BackupArchive", targetId: operation.backupId ?? undefined, metadata: { operationId: operation.id, durationMs: Date.now() - started } });
    return summary;
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "BACKUP_OPERATION_FAILED";
    const retry = operation.attempts < operation.maxAttempts && !["SOURCE_OBJECTS_MISSING", "MANIFEST_CHECKSUM_MISMATCH", "BACKUP_CIPHERTEXT_CORRUPT", "BACKUP_PLAINTEXT_CORRUPT", "RESTORE_TARGET_NOT_ISOLATED", "BACKUP_NOT_EXPIRED"].includes(code);
    await db.backupOperation.update({ where: { id: operation.id }, data: { status: retry ? "RETRYING" : "FAILED", nextAttemptAt: retry ? retryAt(operation.attempts) : new Date(), completedAt: retry ? null : new Date(), durationMs: Date.now() - started, errorCode: code, claimedBy: null } });
    if (operation.type === "CREATE" && operation.backupId) await db.backupArchive.update({ where: { id: operation.backupId }, data: { status: code === "SOURCE_OBJECTS_MISSING" ? "INCOMPLETE" : "FAILED", errorCode: code } });
    if (["VERIFY", "SIMULATE_RESTORE"].includes(operation.type) && operation.backupId && ["MANIFEST_CHECKSUM_MISMATCH", "BACKUP_CIPHERTEXT_CORRUPT", "BACKUP_PLAINTEXT_CORRUPT", "RESTORE_DATABASE_CHECKSUM_MISMATCH"].includes(code)) await db.backupArchive.update({ where: { id: operation.backupId }, data: { status: "CORRUPT", errorCode: code } });
    await audit({ actorId: operation.requestedById ?? undefined, action: `BACKUP_${operation.type}_FAILED`, targetType: "BackupArchive", targetId: operation.backupId ?? undefined, metadata: { operationId: operation.id, errorCode: code, retry } });
    throw error;
  }
}
