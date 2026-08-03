import { NextResponse } from "next/server";
import { schedulerHealth } from "@/lib/scheduler/health";

export async function GET() {
  const health = await schedulerHealth();
  return NextResponse.json({ status: health.status, registeredJobs: health.registeredJobs, jobs: health.jobs.map((job) => ({ key: job.key, enabled: job.enabled, health: job.health, nextRunAt: job.nextRunAt, lastSuccessAt: job.lastSuccessAt, consecutiveFailures: job.consecutiveFailures, retryBacklog: job.retryBacklog })) });
}
