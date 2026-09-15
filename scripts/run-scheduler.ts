import { runDueScheduledJobs, runScheduledJob } from "../apps/web/scheduler/service";
import { schedulerJobDefinitions } from "../apps/web/scheduler/job-definitions";

const key = process.argv.find((argument) => argument.startsWith("--job="))?.slice(6);
const dryRun = process.argv.includes("--dry-run");
const result = key
  ? await runScheduledJob({ key, trigger: "CLI", dryRun })
  : dryRun
    ? await Promise.all(schedulerJobDefinitions.map((job) => runScheduledJob({ key: job.key, trigger: "CLI", dryRun: true })))
    : await runDueScheduledJobs("CLI");
console.info(JSON.stringify(result));
