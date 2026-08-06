import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { claimBackupOperation, recoverAbandonedBackupOperations, requestBackup, requestBackupOperation } from "@/lib/backups/service";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const ids: string[] = [];

describe.sequential("backup operation durability", () => {
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { targetId: { in: ids } } });
    await db.backupOperation.deleteMany({ where: { backupId: { in: ids } } });
    await db.backupArchive.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  });

  it("deduplicates backup requests transactionally", async () => {
    const key = `backup-test-${suffix}`;
    const [first, second] = await Promise.all([
      requestBackup({ trigger: "CLI", dryRun: true, idempotencyKey: key }),
      requestBackup({ trigger: "CLI", dryRun: true, idempotencyKey: key }),
    ]);
    ids.push(first.backupId!);
    expect(first.backupId).toBe(second.backupId);
    expect(await db.backupOperation.count({ where: { idempotencyKey: key } })).toBe(1);
    await db.backupOperation.update({ where: { id: first.id }, data: { status: "FAILED", completedAt: new Date() } });
  });

  it("allows only one worker to claim an operation", async () => {
    const requested = await requestBackup({ trigger: "CLI", dryRun: true, idempotencyKey: `claim-${suffix}` }); ids.push(requested.backupId!);
    const [first, second] = await Promise.all([claimBackupOperation("worker-a"), claimBackupOperation("worker-b")]);
    const claimed = [first, second].filter((item) => item?.id === requested.id);
    expect(claimed).toHaveLength(1);
    await db.backupOperation.update({ where: { id: requested.id }, data: { status: "FAILED", completedAt: new Date() } });
  });

  it("recovers abandoned work without duplicating its archive", async () => {
    const requested = await requestBackup({ trigger: "CLI", dryRun: true, idempotencyKey: `recover-${suffix}` }); ids.push(requested.backupId!);
    await db.backupOperation.update({ where: { id: requested.id }, data: { status: "PROCESSING", attempts: 1, startedAt: new Date(Date.now() - 2 * 60 * 60_000) } });
    expect(await recoverAbandonedBackupOperations()).toBeGreaterThanOrEqual(1);
    expect((await db.backupOperation.findUniqueOrThrow({ where: { id: requested.id } })).status).toBe("RETRYING");
    expect(await db.backupArchive.count({ where: { id: requested.backupId! } })).toBe(1);
  });

  it("rejects restore requests before writing an operation", async () => {
    const requested = await requestBackup({ trigger: "CLI", dryRun: true, idempotencyKey: `restore-${suffix}` }); ids.push(requested.backupId!);
    const before = await db.backupOperation.count({ where: { backupId: requested.backupId } });
    await expect(requestBackupOperation({ backupId: requested.backupId!, type: "RESTORE_ISOLATED", actorId: undefined, confirmation: "wrong" })).rejects.toThrow("INVALID_RESTORE_CONFIRMATION");
    expect(await db.backupOperation.count({ where: { backupId: requested.backupId } })).toBe(before);
  });
});
