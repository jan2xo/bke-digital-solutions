import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { claimBackupOperation, recoverAbandonedBackupOperations } from "@/lib/backups/service";
import { executeBackupOperation } from "@/lib/backups/engine";

const workerId = `${env.DEPLOYMENT_ID}:${randomUUID()}`;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

await recoverAbandonedBackupOperations();
while (!stopping) {
  const operation = await claimBackupOperation(workerId);
  if (!operation) {
    await new Promise((resolve) => setTimeout(resolve, env.BACKUP_WORKER_POLL_SECONDS * 1000));
    continue;
  }
  try {
    const startedAt = Date.now();
    await executeBackupOperation(operation);
    console.log(JSON.stringify({ level: "info", event: "backup_operation_succeeded", operationId: operation.id, operationType: operation.type, durationMs: Date.now() - startedAt }));
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "backup_operation_failed", operationId: operation.id, errorCode: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "BACKUP_OPERATION_FAILED" }));
  }
}
