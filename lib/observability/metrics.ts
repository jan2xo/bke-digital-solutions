import "server-only";
import { db } from "@/lib/db";
import { readiness } from "@/lib/health";
import { schedulerHealth } from "@/lib/scheduler/health";
import { env } from "@/lib/env";

export type HealthState = "HEALTHY" | "WARNING" | "CRITICAL";
export type MetricValue = number | string | boolean | null;
export type PlatformMetric = { key: string; value: MetricValue; unit?: string; state: HealthState; observedAt: string };
export type ObservabilityCard = { key: string; label: string; state: HealthState; summary: string; metrics: PlatformMetric[] };

function stateFor(ok: boolean, warning = false): HealthState { return ok ? (warning ? "WARNING" : "HEALTHY") : "CRITICAL"; }
function metric(key: string, value: MetricValue, state: HealthState, unit?: string): PlatformMetric { return { key, value, state, unit, observedAt: new Date().toISOString() }; }

export async function collectObservability() {
  const observedAt = new Date().toISOString();
  const readinessResult = await readiness();
  const scheduler = await schedulerHealth();
  const schedulerRetryBacklog = scheduler.jobs.reduce((sum, job) => sum + job.retryBacklog, 0);
  const schedulerFailures = scheduler.jobs.reduce((sum, job) => sum + job.consecutiveFailures, 0);
  const backup = await db.backupArchive.findFirst({ orderBy: { createdAt: "desc" }, select: { status: true, sizeBytes: true, durationMs: true, missingObjectCount: true, verifiedAt: true, completedAt: true } });
  const openAlerts = await db.observabilityAlert.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  const failedEmail = await db.emailOutbox.count({ where: { status: { in: ["FAILED", "RETRYING"] } } });
  const failedWebhooks = await db.webhookEvent.count({ where: { status: { in: ["FAILED", "RETRYING"] } } }).catch(() => 0);
  const appState = stateFor(true);
  const dependencyState = stateFor(readinessResult.ready, Object.values(readinessResult.checks).some((value) => value === "down"));
  const schedulerState: HealthState = scheduler.status === "healthy" ? "HEALTHY" : scheduler.status === "degraded" ? "WARNING" : "CRITICAL";
  const backupState: HealthState = !backup ? "WARNING" : backup.missingObjectCount > 0 || ["FAILED", "CORRUPT", "INCOMPLETE"].includes(backup.status) ? "CRITICAL" : backup.status === "VERIFIED" ? "HEALTHY" : "WARNING";
  const cards: ObservabilityCard[] = [
    { key: "application", label: "Application", state: appState, summary: `Build ${env.DEPLOYMENT_ID ?? "local"}`, metrics: [metric("uptime", Math.floor(process.uptime()), appState, "seconds"), metric("deployment", env.DEPLOYMENT_ID ?? "local", appState)] },
    { key: "database", label: "Database", state: dependencyState, summary: readinessResult.checks.postgresql === "up" ? "PostgreSQL reachable" : "PostgreSQL unavailable", metrics: [metric("postgresql", readinessResult.checks.postgresql, dependencyState)] },
    { key: "valkey", label: "Valkey", state: stateFor(readinessResult.checks.valkey === "up"), summary: readinessResult.checks.valkey === "up" ? "Valkey reachable" : "Valkey unavailable", metrics: [metric("valkey", readinessResult.checks.valkey, stateFor(readinessResult.checks.valkey === "up"))] },
    { key: "storage", label: "Storage", state: stateFor(readinessResult.checks.objectStorage === "up"), summary: readinessResult.checks.objectStorage === "up" ? "Object storage reachable" : "Object storage unavailable", metrics: [metric("object_storage", readinessResult.checks.objectStorage, stateFor(readinessResult.checks.objectStorage === "up"))] },
    { key: "scheduler", label: "Scheduler", state: schedulerState, summary: `${scheduler.registeredJobs} registered jobs`, metrics: [metric("registered_jobs", scheduler.registeredJobs, schedulerState), metric("retry_backlog", schedulerRetryBacklog, schedulerState), metric("failed_jobs", schedulerFailures, schedulerState)] },
    { key: "backups", label: "Backups", state: backupState, summary: backup ? `${backup.status} · ${backup.missingObjectCount} missing objects` : "No archive recorded", metrics: [metric("last_status", backup?.status ?? null, backupState), metric("missing_objects", backup?.missingObjectCount ?? null, backupState), metric("duration_ms", backup?.durationMs ?? null, backupState, "ms")] },
    { key: "payments", label: "Payments", state: stateFor(failedWebhooks === 0, failedWebhooks > 0), summary: `${failedWebhooks} retryable webhook failures`, metrics: [metric("webhook_failures", failedWebhooks, failedWebhooks ? "WARNING" : "HEALTHY")] },
    { key: "licensing", label: "Licensing", state: "HEALTHY", summary: "Platform issuance metrics available", metrics: [metric("source", "commerce_platform", "HEALTHY")] },
    { key: "email", label: "Email", state: stateFor(failedEmail === 0, failedEmail > 0), summary: `${failedEmail} failed or retrying messages`, metrics: [metric("failed_or_retrying", failedEmail, failedEmail ? "WARNING" : "HEALTHY")] },
    { key: "security", label: "Security", state: stateFor(openAlerts === 0, openAlerts > 0), summary: `${openAlerts} open alerts`, metrics: [metric("open_alerts", openAlerts, openAlerts ? "WARNING" : "HEALTHY")] },
    { key: "infrastructure", label: "Infrastructure", state: dependencyState, summary: "Container-level metrics supplied by deployment runtime", metrics: [metric("runtime", process.release.name, dependencyState)] },
  ];
  return { observedAt, overall: cards.some((card) => card.state === "CRITICAL") ? "CRITICAL" : cards.some((card) => card.state === "WARNING") ? "WARNING" : "HEALTHY", cards };
}

export async function listAlerts() { return db.observabilityAlert.findMany({ orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }], take: 100 }); }

export async function syncObservabilityAlerts(snapshot: Awaited<ReturnType<typeof collectObservability>>) {
  for (const card of snapshot.cards.filter((item) => item.state !== "HEALTHY")) {
    const severity = card.state === "CRITICAL" ? "CRITICAL" : "WARNING";
    const fingerprint = `monitoring:${card.key}:${severity}`;
    const existing = await db.observabilityAlert.findFirst({ where: { fingerprint, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
    if (existing) { await db.observabilityAlert.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), detail: card.summary, metadata: { metrics: card.metrics } } }); }
    else { await db.observabilityAlert.create({ data: { fingerprint, source: card.key, title: `${card.label} health is ${card.state}`, detail: card.summary, severity, metadata: { metrics: card.metrics } } }); }
  }
  return listAlerts();
}
