import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY || !process.env.S3_ENDPOINT ||
    !process.env.S3_BUCKET || !process.env.DATABASE_URL || !process.env.BACKUP_RESTORE_DATABASE_URL ||
    !process.env.BACKUP_RESTORE_S3_BUCKET) {
  throw new Error("BACKUP_CERTIFICATION_DISPOSABLE_STORAGE_NOT_CONFIGURED");
}
if (process.env.DEPLOYMENT_ENV === "production") throw new Error("BACKUP_CERTIFICATION_PRODUCTION_FORBIDDEN");
// Never turn this executable fixture into a Neon or Cloudflare production mutation by
// changing only DEPLOYMENT_ENV. Every data and object endpoint must be loopback.
const loopback = (value: string): boolean => {
  const u = new URL(value);
  return u.hostname === "127.0.0.1" || u.hostname === "localhost";
};
if (!loopback(process.env.DATABASE_URL) ||
    !loopback(process.env.BACKUP_RESTORE_DATABASE_URL) ||
    !loopback(process.env.S3_ENDPOINT) ||
    new URL(process.env.DATABASE_URL).pathname !== "/bke_test" ||
    process.env.PAYMENT_PROVIDER !== "mock") {
  throw new Error("BACKUP_CERTIFICATION_DISPOSABLE_TARGET_REQUIRED");
}

process.env.BACKUP_ENABLED = "true";
process.env.BACKUP_S3_ENDPOINT = process.env.S3_ENDPOINT;
process.env.BACKUP_S3_REGION = process.env.S3_REGION ?? "auto";
process.env.BACKUP_BUCKET = process.env.BACKUP_BUCKET ?? "bke-certification-backups";
process.env.BACKUP_S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
process.env.BACKUP_S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
process.env.BACKUP_S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE ?? "true";
process.env.BACKUP_RESTORE_S3_ENDPOINT = process.env.S3_ENDPOINT;
process.env.BACKUP_RESTORE_S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
process.env.BACKUP_RESTORE_S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
process.env.BACKUP_RESTORE_S3_REGION = process.env.S3_REGION ?? "auto";
process.env.BACKUP_RESTORE_ACK = "ISOLATED_TARGET_ONLY";
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const client = new S3Client({
  region: process.env.S3_REGION ?? "auto",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
});
async function createBucket(bucket: string) {
  try { await client.send(new CreateBucketCommand({ Bucket: bucket })); } catch (error) {
    const code = error instanceof Error && "name" in error ? error.name : "";
    if (!code.includes("BucketAlready")) throw error;
  }
}
for (const bucket of [process.env.S3_BUCKET, process.env.BACKUP_BUCKET, process.env.BACKUP_RESTORE_S3_BUCKET])
  await createBucket(bucket);

const sourceObjects = new Map([
  ["images/ci-product.png", Buffer.from("BKE synthetic image fixture")],
  ["evidence/v1/ci-provenance.json", Buffer.from('{"kind":"synthetic","ci":true}')],
  ["installers/ci-artifact.bin", Buffer.from("BKE synthetic private installer fixture")],
]);
for (const [key, bytes] of sourceObjects) await client.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET, Key: key, Body: bytes,
}));

const sourceDB = new Client({ connectionString: process.env.DATABASE_URL });
await sourceDB.connect();
try {
  // Only the disposable test server is mutated by this certification script.
  const product = await sourceDB.query<{ id: string }>('SELECT id FROM "Product" ORDER BY id LIMIT 1');
  if (product.rows[0]) {
    await sourceDB.query('UPDATE "Product" SET "imageKey"=$1 WHERE id=$2',
      ["images/ci-product.png", product.rows[0].id]);
  }
  const targetDatabase = new URL(process.env.BACKUP_RESTORE_DATABASE_URL).pathname.slice(1);
  if (!/^bke_restore_[a-z0-9_]+$/.test(targetDatabase)) throw new Error("BACKUP_CERTIFICATION_TARGET_NAME_UNSAFE");
  const exists = await sourceDB.query("SELECT 1 FROM pg_database WHERE datname=$1", [targetDatabase]);
  if (exists.rowCount !== 0) throw new Error("BACKUP_CERTIFICATION_RESTORE_TARGET_NOT_EMPTY");
  await sourceDB.query('CREATE DATABASE "' + targetDatabase + '"');
} finally {
  await sourceDB.end();
}

const { claimBackupOperation, requestBackup, requestBackupOperation } = await import("@/lib/backups/service");
const { executeBackupOperation } = await import("@/lib/backups/engine");
const { db } = await import("@/platform/host/db");

async function runOperation(operation: { id: string; backupId?: string | null }, label: string) {
  const claim = await claimBackupOperation("certification-backup-worker");
  if (!claim || claim.id !== operation.id) throw new Error("BACKUP_CERTIFICATION_CLAIM_FAILED:" + label);
  return executeBackupOperation(claim);
}
try {
  const created = await requestBackup({ trigger: "CLI", idempotencyKey: "certification-backup:" + Date.now() });
  const archive = await runOperation(created, "CREATE");
  if (Number(archive.objects) < sourceObjects.size) throw new Error("BACKUP_CERTIFICATION_OBJECTS_MISSING");

  const verified = await requestBackupOperation({ backupId: created.backupId!, type: "VERIFY" });
  await runOperation(verified, "VERIFY");
  const simulated = await requestBackupOperation({ backupId: created.backupId!, type: "SIMULATE_RESTORE" });
  await runOperation(simulated, "SIMULATE_RESTORE");
  const restored = await requestBackupOperation({
    backupId: created.backupId!, type: "RESTORE_ISOLATED",
    confirmation: "RESTORE TO ISOLATED TARGET " + created.backupId,
  });
  const result = await runOperation(restored, "RESTORE_ISOLATED");
  if (result.isolated !== true || Number(result.restoredObjects) < sourceObjects.size ||
      result.tableCountsVerified !== true) throw new Error("BACKUP_CERTIFICATION_RESTORE_INCOMPLETE");

  for (const [key, bytes] of sourceObjects) {
    const obj = await client.send(new GetObjectCommand({ Bucket: process.env.BACKUP_RESTORE_S3_BUCKET!, Key: key }));
    if (!obj.Body || !Buffer.from(await obj.Body.transformToByteArray()).equals(bytes))
      throw new Error("BACKUP_CERTIFICATION_OBJECT_ROUNDTRIP_FAILED");
  }
  const state = await db.backupArchive.findUniqueOrThrow({ where: { id: created.backupId! } });
  if (state.status !== "VERIFIED" || state.objectCount < sourceObjects.size)
    throw new Error("BACKUP_CERTIFICATION_ARCHIVE_NOT_VERIFIED");
  console.log(JSON.stringify({
    create: "PASS", verify: "PASS", simulateRestore: "PASS",
    isolatedRestore: "PASS", restoredPrivateObjects: result.restoredObjects,
    restoredDatabaseCounts: "PASS",
  }));
} finally {
  await db.$disconnect();
}
