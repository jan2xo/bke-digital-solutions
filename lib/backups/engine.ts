import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "@/platform/host/db";
import { env } from "@/platform/host/env";
import { audit } from "@/lib/audit";
import { backupManifestSchema, canonicalJson, decryptBuffer, encryptBuffer, sha256, verifyManifest, type BackupManifest } from "@/lib/backups/integrity";
import { retryAt } from "@/lib/backups/policy";
import { assertIsolatedRestoreTargets, encryptedObjectKey, reconcileSourceObjects } from "@/lib/backups/recovery-safety";
import type { BackupOperation } from "@/platform/host/generated/prisma/client";

const exec = promisify(execFile);

function backupClient() {
  if (!env.BACKUP_S3_ACCESS_KEY_ID || !env.BACKUP_S3_SECRET_ACCESS_KEY || !env.BACKUP_BUCKET) throw new Error("BACKUP_STORAGE_NOT_CONFIGURED");
  return new S3Client({ region: env.BACKUP_S3_REGION, endpoint: env.BACKUP_S3_ENDPOINT, forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE, credentials: { accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY } });
}

/** This is a dedicated Node/pg_dump worker. Source private objects are not optional. */
function sourceStorage() {
  const bucket = process.env.S3_BUCKET?.trim();
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) throw new Error("SOURCE_STORAGE_NOT_CONFIGURED");
  if (bucket === env.BACKUP_BUCKET) throw new Error("BACKUP_SOURCE_BUCKET_NOT_ISOLATED");
  if (env.DEPLOYMENT_ENV === "production" && accessKeyId === env.BACKUP_S3_ACCESS_KEY_ID)
    throw new Error("BACKUP_SOURCE_CREDENTIALS_NOT_ISOLATED");
  return {
    bucket, accessKeyId,
    client: new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

function restoreStorage() {
  const bucket = process.env.BACKUP_RESTORE_S3_BUCKET?.trim();
  const endpoint = process.env.BACKUP_RESTORE_S3_ENDPOINT?.trim();
  const accessKeyId = process.env.BACKUP_RESTORE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BACKUP_RESTORE_S3_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) throw new Error("ISOLATED_RESTORE_STORAGE_NOT_CONFIGURED");
  return {
    bucket, accessKeyId,
    client: new S3Client({
      region: process.env.BACKUP_RESTORE_S3_REGION || "auto",
      endpoint,
      forcePathStyle: process.env.BACKUP_RESTORE_S3_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024; // Until streaming/multipart encryption is certified.
function checkBoundedSize(size: number | undefined): void {
  if (size === undefined || !Number.isSafeInteger(size) || size < 0) throw new Error("BACKUP_OBJECT_SIZE_UNKNOWN");
  if (size > MAX_ARTIFACT_BYTES) throw new Error("BACKUP_OBJECT_EXCEEDS_MEMORY_LIMIT");
}

function requireFullManifest(manifest: BackupManifest): void {
  if (!manifest.runtime.sourceBucket) throw new Error("BACKUP_LEGACY_DATABASE_ONLY");
  if (manifest.missingSourceObjects.length) throw new Error("SOURCE_OBJECTS_MISSING");
  if (new Set(manifest.objects.map((item) => item.sourceKey)).size !== manifest.objects.length ||
      new Set(manifest.objects.map((item) => item.backupKey)).size !== manifest.objects.length ||
      manifest.objects.some((item) => item.backupKey === manifest.database.backupKey)) {
    throw new Error("BACKUP_MANIFEST_OBJECT_DUPLICATE");
  }
}

async function referencedPrivateObjectKeys() {
  const products = await db.product.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } });
  return products.flatMap((product) => product.imageKey ? [product.imageKey] : []);
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
    if (page.IsTruncated && !page.NextContinuationToken) throw new Error("BACKUP_OBJECT_INVENTORY_TRUNCATED");
    continuationToken = page.NextContinuationToken;
  } while (continuationToken);
  return keys.sort();
}

async function getBytes(client: S3Client, bucket: string, key: string) {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error("BACKUP_OBJECT_MISSING");
  checkBoundedSize(result.ContentLength);
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  checkBoundedSize(bytes.length);
  if (bytes.length !== result.ContentLength) throw new Error("BACKUP_OBJECT_SIZE_MISMATCH");
  return bytes;
}

async function tableCounts() {
  const [users, orders, payments, invoices, licenses, subscriptions, legalAcceptances, audits, scheduledRuns] = await Promise.all([
    db.user.count(), db.order.count(), db.payment.count(), db.invoice.count(), db.license.count(), db.subscription.count(), db.legalAcceptance.count(), db.auditLog.count(), db.scheduledJobRun.count(),
  ]);
  return { users, orders, payments, invoices, licenses, subscriptions, legalAcceptances, audits, scheduledRuns };
}

async function createArchive(operation: BackupOperation & { backup: NonNullable<unknown> }) {
  const backup = await db.backupArchive.findUniqueOrThrow({ where: { id: operation.backupId! } });
  if (operation.dryRun) return { dryRun: true, sourceObjects: 0, missingSourceObjects: 0 };
  if (!env.BACKUP_ENABLED) throw new Error("BACKUPS_DISABLED");
  const startedAt = new Date();
  await db.backupArchive.update({ where: { id: backup.id }, data: { status: "CREATING", startedAt } });
  const work = await mkdtemp(join(tmpdir(), "bke-backup-"));
  try {
    await chmod(work, 0o700);
    const dumpPath = join(work, "database.dump");
    await exec("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-acl", "--file", dumpPath], { env: pgEnvironment(env.DATABASE_URL), maxBuffer: 1024 * 1024 });
    checkBoundedSize((await stat(dumpPath)).size);
    const dump = await readFile(dumpPath);
    const encryptedDatabase = encryptBuffer(dump, encryptionKey());
    const databaseKey = backup.storagePrefix + "/database.dump.enc";
    const destination = backupClient();
    const source = sourceStorage();
    await destination.send(new PutObjectCommand({ Bucket: env.BACKUP_BUCKET!, Key: databaseKey, Body: encryptedDatabase.encrypted, ContentType: "application/octet-stream" }));

    const initialKeys = await allObjectKeys(source.client, source.bucket);
    const inventory = reconcileSourceObjects(initialKeys, await referencedPrivateObjectKeys());
    const backedObjects: BackupManifest["objects"] = [];
    const absent = inventory.missingKeys;
    for (const sourceKey of inventory.sourceKeys) {
      // Sequential encryption limits the peak memory footprint; oversized objects stop the archive.
      const plaintext = await getBytes(source.client, source.bucket, sourceKey);
      const encrypted = encryptBuffer(plaintext, encryptionKey());
      const key = encryptedObjectKey(backup.storagePrefix, sourceKey);
      await destination.send(new PutObjectCommand({
        Bucket: env.BACKUP_BUCKET!, Key: key, Body: encrypted.encrypted, ContentType: "application/octet-stream",
      }));
      backedObjects.push({
        sourceKey, backupKey: key, sizeBytes: plaintext.length,
        encryptedSizeBytes: encrypted.encrypted.length,
        sha256: sha256(plaintext), encryptedSha256: sha256(encrypted.encrypted),
        iv: encrypted.iv, authTag: encrypted.authTag,
      });
    }
    const finalKeys = await allObjectKeys(source.client, source.bucket);
    if (JSON.stringify(inventory.sourceKeys) !== JSON.stringify(finalKeys))
      throw new Error("BACKUP_SOURCE_INVENTORY_CHANGED");
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
      runtime: { nodeVersion: process.version, paymentProvider: env.PAYMENT_PROVIDER, emailProvider: env.EMAIL_PROVIDER, providerConfigSource: env.PROVIDER_CONFIG_SOURCE, sourceBucket: source.bucket },
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
  requireFullManifest(manifest);
  const objects = [manifest.database, ...manifest.objects];
  for (const object of objects) {
    const encrypted = await getBytes(backupClient(), env.BACKUP_BUCKET!, object.backupKey);
    if (encrypted.length !== object.encryptedSizeBytes || sha256(encrypted) !== object.encryptedSha256) throw new Error("BACKUP_CIPHERTEXT_CORRUPT");
    if (simulateRestore) {
      const plaintext = decryptBuffer(encrypted, encryptionKey(), object.iv, object.authTag);
      if (plaintext.length !== object.sizeBytes || sha256(plaintext) !== object.sha256) throw new Error("BACKUP_PLAINTEXT_CORRUPT");
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
  if (env.BACKUP_RESTORE_ACK !== "ISOLATED_TARGET_ONLY" || !env.BACKUP_RESTORE_DATABASE_URL)
    throw new Error("ISOLATED_RESTORE_NOT_CONFIGURED");

  const source = sourceStorage();
  const target = restoreStorage();
  assertIsolatedRestoreTargets({
    sourceDatabaseUrl: env.DATABASE_URL,
    targetDatabaseUrl: env.BACKUP_RESTORE_DATABASE_URL,
    sourceBucket: source.bucket,
    backupBucket: env.BACKUP_BUCKET ?? "",
    targetBucket: target.bucket,
    sourceAccessKeyId: source.accessKeyId,
    backupAccessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
    targetAccessKeyId: target.accessKeyId,
    production: env.DEPLOYMENT_ENV === "production",
  });
  const { manifest } = await loadManifest(backupId);
  requireFullManifest(manifest);
  if (manifest.runtime.sourceBucket !== source.bucket) throw new Error("BACKUP_SOURCE_BUCKET_MISMATCH");

  const targetDatabase = new URL(env.BACKUP_RESTORE_DATABASE_URL);
  const pg = new Client({ connectionString: env.BACKUP_RESTORE_DATABASE_URL });
  await pg.connect();
  try {
    // Check BOTH destinations before any destructive or additive restore operation.
    const tables = await pg.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'",
    );
    if (Number(tables.rows[0]?.count) !== 0) throw new Error("RESTORE_DATABASE_NOT_EMPTY");
    if ((await allObjectKeys(target.client, target.bucket)).length !== 0) throw new Error("RESTORE_BUCKET_NOT_EMPTY");

    // Verify all ciphertext and decrypted bytes BEFORE writing either isolated target.
    await verifyArchive(backupId, true);
    const work = await mkdtemp(join(tmpdir(), "bke-restore-"));
    try {
      await chmod(work, 0o700);
      const encrypted = await getBytes(backupClient(), env.BACKUP_BUCKET!, manifest.database.backupKey);
      if (encrypted.length !== manifest.database.encryptedSizeBytes ||
          sha256(encrypted) !== manifest.database.encryptedSha256) throw new Error("BACKUP_CIPHERTEXT_CORRUPT");
      const dump = decryptBuffer(encrypted, encryptionKey(), manifest.database.iv, manifest.database.authTag);
      if (dump.length !== manifest.database.sizeBytes || sha256(dump) !== manifest.database.sha256)
        throw new Error("RESTORE_DATABASE_CHECKSUM_MISMATCH");
      const dumpPath = join(work, "database.dump");
      await writeFile(dumpPath, dump, { mode: 0o600 });
      await exec("pg_restore", ["--list", dumpPath], { maxBuffer: 8 * 1024 * 1024 });
      await exec("pg_restore", [
        "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
        "--dbname", targetDatabase.pathname.slice(1), dumpPath,
      ], { env: pgEnvironment(env.BACKUP_RESTORE_DATABASE_URL), maxBuffer: 1024 * 1024 });

      // The input table names are a fixed internal inventory, never manifest-supplied SQL.
      const tablesToVerify = [
        ["users", "User"], ["orders", "Order"], ["payments", "Payment"],
        ["invoices", "Invoice"], ["licenses", "License"], ["subscriptions", "Subscription"],
        ["legalAcceptances", "LegalAcceptance"], ["audits", "AuditLog"],
        ["scheduledRuns", "ScheduledJobRun"],
      ] as const;
      for (const [countKey, table] of tablesToVerify) {
        const result = await pg.query<{ count: string }>('SELECT count(*)::text AS count FROM "' + table + '"');
        if (Number(result.rows[0]?.count) !== manifest.tableCounts[countKey])
          throw new Error("RESTORED_DATABASE_COUNT_MISMATCH");
      }
      for (const object of manifest.objects) {
        const ciphertext = await getBytes(backupClient(), env.BACKUP_BUCKET!, object.backupKey);
        const restored = decryptBuffer(ciphertext, encryptionKey(), object.iv, object.authTag);
        if (restored.length !== object.sizeBytes || sha256(restored) !== object.sha256)
          throw new Error("RESTORE_OBJECT_CHECKSUM_MISMATCH");
        await target.client.send(new PutObjectCommand({
          Bucket: target.bucket, Key: object.sourceKey, Body: restored,
          ContentType: "application/octet-stream", IfNoneMatch: "*",
        }));
        const check = await getBytes(target.client, target.bucket, object.sourceKey);
        if (sha256(check) !== object.sha256) throw new Error("RESTORED_OBJECT_CHECKSUM_MISMATCH");
      }
      const restoredKeys = await allObjectKeys(target.client, target.bucket);
      if (JSON.stringify(restoredKeys) !== JSON.stringify(manifest.objects.map((x) => x.sourceKey).sort()))
        throw new Error("RESTORED_OBJECT_INVENTORY_MISMATCH");
      return {
        backupId, isolated: true,
        targetFingerprint: sha256(targetDatabase.host + targetDatabase.pathname),
        restoredObjects: manifest.objects.length,
        tableCountsVerified: true,
      };
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } finally {
    await pg.end();
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
