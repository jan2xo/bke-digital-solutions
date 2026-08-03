import type { ScheduledJobTrigger } from "@/generated/prisma/client";

export type JobCategory = "STORAGE" | "EMAIL" | "COMMERCE" | "ENTITLEMENTS" | "CUSTOMER" | "SECURITY" | "PAYMENTS";
export type JobFailureClass = "TRANSIENT" | "PERMANENT" | "CONFIGURATION" | "DEPENDENCY_UNAVAILABLE" | "VALIDATION" | "CONCURRENCY_CONFLICT";
export type JobSummary = Record<string, string | number | boolean | null>;
export type JobContext = { now: Date; dryRun: boolean; correlationId: string };

export type ScheduledJob = {
  key: string;
  name: string;
  description: string;
  category: JobCategory;
  cadenceSeconds: number;
  timeoutSeconds: number;
  lockSeconds: number;
  maxAttempts: number;
  dryRunSupported: boolean;
  healthThresholdSeconds: number;
  auditPolicy: "FAILURES" | "ALL";
  handler(context: JobContext): Promise<JobSummary>;
};

export type RunJobInput = {
  key: string;
  trigger: ScheduledJobTrigger;
  scheduledFor?: Date;
  dryRun?: boolean;
  idempotencyKey?: string;
  parentRunId?: string;
};
