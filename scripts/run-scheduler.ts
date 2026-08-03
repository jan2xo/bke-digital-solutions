import { runDueScheduledJobs, runScheduledJob } from "../lib/scheduler/service";
import { scheduledJobs } from "../lib/scheduler/registry";

const key = process.argv.find((argument) => argument.startsWith("--job="))?.slice(6);
const dryRun = process.argv.includes("--dry-run");
const result = key
  ? await runScheduledJob({ key, trigger: "CLI", dryRun })
  : dryRun
    ? await Promise.all(scheduledJobs.map((job) => runScheduledJob({ key: job.key, trigger: "CLI", dryRun: true })))
    : await runDueScheduledJobs("CLI");
console.info(JSON.stringify(result));
