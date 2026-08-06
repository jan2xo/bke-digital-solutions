import { requestBackup } from "@/lib/backups/service";

const dryRun = process.argv.includes("--dry-run");
const result = await requestBackup({ trigger: "CLI", dryRun });
console.log(JSON.stringify({ operationId: result.id, backupId: result.backupId, status: result.status, dryRun }));
