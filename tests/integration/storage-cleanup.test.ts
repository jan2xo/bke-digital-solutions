import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { processStorageCleanupJob, queueStorageCleanup, recoverAbandonedCleanupJobs, retryStorageCleanupJob } from "@/lib/storage-cleanup";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
let adminId = "";
const jobIds: string[] = [];

describe.sequential("durable storage cleanup", () => {
  beforeAll(async () => { adminId = (await db.user.create({ data: { email: `cleanup-admin-${suffix}@bke.test`, role: "ADMIN" } })).id; });
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { actorId: adminId } });
    await db.securityEvent.deleteMany({ where: { userId: adminId } });
    await db.storageCleanupJob.deleteMany({ where: { id: { in: jobIds } } });
    await db.user.deleteMany({ where: { id: adminId } });
    await db.$disconnect();
  });

  it("deduplicates jobs and allows only one concurrent worker to claim an object", async () => {
    const input = { type: "ORPHANED_OBJECT" as const, targetType: "Upload", targetId: `concurrent-${suffix}`, objectKey: `private/${suffix}/concurrent.zip`, actorId: adminId };
    const [first, duplicate] = await Promise.all([queueStorageCleanup(input), queueStorageCleanup(input)]);
    jobIds.push(first.id);
    expect(duplicate.id).toBe(first.id);
    let deletions = 0;
    const results = await Promise.all([processStorageCleanupJob(first.id, async () => { deletions += 1; }), processStorageCleanupJob(first.id, async () => { deletions += 1; })]);
    expect(deletions).toBe(1);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(await db.storageCleanupJob.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 1 });
  });

  it("records bounded failures and supports an explicit retry", async () => {
    const job = await queueStorageCleanup({ type: "ARTIFACT_REMOVAL", targetType: "ProductArtifact", targetId: `retry-${suffix}`, objectKey: `private/${suffix}/retry.zip`, actorId: adminId });
    jobIds.push(job.id);
    await processStorageCleanupJob(job.id, async () => { throw new Error("secret path must not be persisted as an error"); });
    const failed = await db.storageCleanupJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("RETRYING");
    expect(failed.lastErrorCode).toMatch(/^[a-f0-9]{16}$/);
    expect(failed.lastErrorCode).not.toContain("secret");
    await retryStorageCleanupJob(job.id, adminId);
    await processStorageCleanupJob(job.id, async () => undefined);
    expect(await db.storageCleanupJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SUCCEEDED", attempts: 2 });
  });

  it("recovers abandoned processing claims", async () => {
    const job = await queueStorageCleanup({ type: "ABANDONED_UPLOAD", targetType: "Upload", targetId: `abandoned-${suffix}`, objectKey: `private/${suffix}/abandoned.zip`, actorId: adminId });
    jobIds.push(job.id);
    await db.storageCleanupJob.update({ where: { id: job.id }, data: { status: "PROCESSING", startedAt: new Date(Date.now() - 20 * 60_000) } });
    expect((await recoverAbandonedCleanupJobs()).count).toBeGreaterThanOrEqual(1);
    expect(await db.storageCleanupJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "RETRYING", lastErrorCode: "PROCESSING_TIMEOUT" });
  });
});
