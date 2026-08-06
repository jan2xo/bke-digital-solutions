import { randomBytes } from "node:crypto";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";

if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY || !process.env.S3_ENDPOINT) throw new Error("SOURCE_STORAGE_NOT_CONFIGURED");
process.env.BACKUP_ENABLED = "true";
process.env.BACKUP_S3_ENDPOINT = process.env.S3_ENDPOINT;
process.env.BACKUP_S3_REGION = process.env.S3_REGION ?? "auto";
process.env.BACKUP_BUCKET = `${process.env.DEPLOYMENT_ID ?? "bke-certification"}-backups`;
process.env.BACKUP_S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
process.env.BACKUP_S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
process.env.BACKUP_S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE ?? "true";
process.env.BACKUP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const client = new S3Client({ region: process.env.BACKUP_S3_REGION, endpoint: process.env.BACKUP_S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY } });
try { await client.send(new CreateBucketCommand({ Bucket: process.env.BACKUP_BUCKET })); } catch (error) {
  const code = error instanceof Error && "name" in error ? error.name : "";
  if (!code.includes("BucketAlready")) throw error;
}

const { claimBackupOperation, requestBackup, requestBackupOperation } = await import("@/lib/backups/service");
const { executeBackupOperation } = await import("@/lib/backups/engine");
const create = await requestBackup({ trigger: "CLI", idempotencyKey: `certification-backup:${Date.now()}` });
const createClaim = await claimBackupOperation("certification-worker");
if (!createClaim || createClaim.id !== create.id) throw new Error("CERTIFICATION_BACKUP_CLAIM_FAILED");
await executeBackupOperation(createClaim);
const verify = await requestBackupOperation({ backupId: create.backupId!, type: "VERIFY" });
const verifyClaim = await claimBackupOperation("certification-worker");
if (!verifyClaim || verifyClaim.id !== verify.id) throw new Error("CERTIFICATION_VERIFY_CLAIM_FAILED");
await executeBackupOperation(verifyClaim);
const simulate = await requestBackupOperation({ backupId: create.backupId!, type: "SIMULATE_RESTORE" });
const simulateClaim = await claimBackupOperation("certification-worker");
if (!simulateClaim || simulateClaim.id !== simulate.id) throw new Error("CERTIFICATION_SIMULATION_CLAIM_FAILED");
await executeBackupOperation(simulateClaim);
console.log(JSON.stringify({ backupId: create.backupId, create: "passed", verify: "passed", restoreSimulation: "passed" }));
