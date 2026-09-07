import "server-only";

import { db } from "@/lib/db";
import { schedulerHealth } from "@/lib/scheduler/health";
import { readiness } from "@/v2/apps/web/health/readiness";
import {
  collectObservability as collectPlatformObservability,
  metric,
  stateFor,
  syncObservabilityAlerts as syncPlatformObservabilityAlerts,
  type HealthState,
  type ObservabilityAlert,
  type ObservabilityAlertStore,
  type ObservabilityCard,
  type ObservabilitySnapshot,
  type ObservabilitySource,
} from "@/v2/platform/observability";

const hostOperationalSource: ObservabilitySource = {
  async collect(observedAt) {
    const readinessResult = await readiness();
    const scheduler = await schedulerHealth();
    const schedulerRetryBacklog = scheduler.jobs.reduce((sum, job) => sum + job.retryBacklog, 0);
    const schedulerFailures = scheduler.jobs.reduce((sum, job) => sum + job.consecutiveFailures, 0);
    const [backup, openAlerts, failedEmail, pendingEmail, failedWebhooks, openReconciliation, pendingPayments, pendingLeaseOperations, failedLeaseOperations, expiringLicenses] = await Promise.all([
      db.backupArchive.findFirst({ orderBy: { createdAt: "desc" }, select: { status: true, sizeBytes: true, durationMs: true, missingObjectCount: true, verifiedAt: true, completedAt: true } }),
      db.observabilityAlert.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
      db.emailOutbox.count({ where: { status: { in: ["FAILED", "RETRYING"] } } }),
      db.emailOutbox.count({ where: { status: "PENDING" } }),
      db.webhookEvent.count({ where: { status: { in: ["FAILED", "RETRYING"] } } }).catch(() => 0),
      db.paymentReconciliation.count({ where: { status: "OPEN" } }),
      db.paymentAttempt.count({ where: { status: { in: ["PENDING", "OPEN", "RETRYING"] } } }),
      db.commercialLeaseOperation.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      db.commercialLeaseOperation.count({ where: { status: { in: ["FAILED", "REJECTED"] } } }),
      db.license.count({ where: { status: "ACTIVE", expiresAt: { not: null, lte: new Date(observedAt.getTime() + 30 * 24 * 60 * 60 * 1000) } } }),
    ]);

    const appState = stateFor(true);
    const dependencyState = stateFor(
      readinessResult.ready,
      Object.values(readinessResult.checks).some((value) => value === "down"),
    );
    const schedulerState: HealthState = scheduler.status === "healthy" ? "HEALTHY" : scheduler.status === "degraded" ? "WARNING" : "CRITICAL";
    const backupState: HealthState = !backup
      ? "WARNING"
      : backup.missingObjectCount > 0 || ["FAILED", "CORRUPT", "INCOMPLETE"].includes(backup.status)
        ? "CRITICAL"
        : backup.status === "VERIFIED"
          ? "HEALTHY"
          : "WARNING";

    const postgresql = readinessResult.checks.postgresql ?? "down";
    const valkey = readinessResult.checks.valkey ?? "down";
    const objectStorage = readinessResult.checks.objectStorage ?? "down";
    const deploymentId = process.env.DEPLOYMENT_ID?.trim() || "bke-development";

    const cards: ObservabilityCard[] = [
      {
        key: "application",
        label: "Application",
        state: appState,
        summary: `Build ${deploymentId}`,
        metrics: [
          metric("uptime", Math.floor(process.uptime()), appState, observedAt, "seconds"),
          metric("deployment", deploymentId, appState, observedAt),
        ],
      },
      {
        key: "database",
        label: "Database",
        state: dependencyState,
        summary: postgresql === "up" ? "PostgreSQL reachable" : "PostgreSQL unavailable",
        metrics: [metric("postgresql", postgresql, dependencyState, observedAt)],
      },
      {
        key: "valkey",
        label: "Valkey",
        state: stateFor(valkey === "up"),
        summary: valkey === "up" ? "Valkey reachable" : "Valkey unavailable",
        metrics: [metric("valkey", valkey, stateFor(valkey === "up"), observedAt)],
      },
      {
        key: "storage",
        label: "Storage",
        state: stateFor(objectStorage === "up"),
        summary: objectStorage === "up" ? "Object storage reachable" : "Object storage unavailable",
        metrics: [metric("object_storage", objectStorage, stateFor(objectStorage === "up"), observedAt)],
      },
      {
        key: "scheduler",
        label: "Scheduler",
        state: schedulerState,
        summary: `${scheduler.registeredJobs} registered jobs`,
        metrics: [
          metric("registered_jobs", scheduler.registeredJobs, schedulerState, observedAt),
          metric("retry_backlog", schedulerRetryBacklog, schedulerState, observedAt),
          metric("failed_jobs", schedulerFailures, schedulerState, observedAt),
        ],
      },
      {
        key: "backups",
        label: "Backups",
        state: backupState,
        summary: backup ? `${backup.status} · ${backup.missingObjectCount} missing objects` : "No archive recorded",
        metrics: [
          metric("last_status", backup?.status ?? null, backupState, observedAt),
          metric("missing_objects", backup?.missingObjectCount ?? null, backupState, observedAt),
          metric("duration_ms", backup?.durationMs ?? null, backupState, observedAt, "ms"),
        ],
      },
      {
        key: "payments",
        label: "Payments",
        state: stateFor(failedWebhooks === 0 && openReconciliation === 0, failedWebhooks > 0 || openReconciliation > 0),
        summary: `${failedWebhooks} webhook failures · ${openReconciliation} open reconciliations`,
        metrics: [
          metric("webhook_failures", failedWebhooks, failedWebhooks ? "WARNING" : "HEALTHY", observedAt),
          metric("open_reconciliations", openReconciliation, openReconciliation ? "WARNING" : "HEALTHY", observedAt),
          metric("pending_attempts", pendingPayments, pendingPayments ? "WARNING" : "HEALTHY", observedAt),
        ],
      },
      {
        key: "licensing",
        label: "Licensing",
        state: stateFor(failedLeaseOperations === 0 && expiringLicenses === 0, failedLeaseOperations > 0 || expiringLicenses > 0),
        summary: `${pendingLeaseOperations} lease operations pending · ${failedLeaseOperations} failed`,
        metrics: [
          metric("pending_lease_operations", pendingLeaseOperations, pendingLeaseOperations ? "WARNING" : "HEALTHY", observedAt),
          metric("failed_lease_operations", failedLeaseOperations, failedLeaseOperations ? "WARNING" : "HEALTHY", observedAt),
          metric("licenses_expiring_30d", expiringLicenses, expiringLicenses ? "WARNING" : "HEALTHY", observedAt),
          metric("source", "commerce_platform", "HEALTHY", observedAt),
        ],
      },
      {
        key: "email",
        label: "Email",
        state: stateFor(failedEmail === 0, failedEmail > 0),
        summary: `${failedEmail} failed or retrying messages · ${pendingEmail} pending`,
        metrics: [
          metric("failed_or_retrying", failedEmail, failedEmail ? "WARNING" : "HEALTHY", observedAt),
          metric("pending", pendingEmail, pendingEmail ? "WARNING" : "HEALTHY", observedAt),
        ],
      },
      {
        key: "security",
        label: "Security",
        state: stateFor(openAlerts === 0, openAlerts > 0),
        summary: `${openAlerts} open alerts`,
        metrics: [metric("open_alerts", openAlerts, openAlerts ? "WARNING" : "HEALTHY", observedAt)],
      },
      {
        key: "infrastructure",
        label: "Infrastructure",
        state: dependencyState,
        summary: "Container-level metrics supplied by deployment runtime",
        metrics: [metric("runtime", process.release.name, dependencyState, observedAt)],
      },
    ];
    return cards;
  },
};

type PersistedAlert = Readonly<{
  id: string;
  fingerprint: string;
  source: string;
  title: string;
  detail: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}>;

const alertSelection = {
  id: true,
  fingerprint: true,
  source: true,
  title: true,
  detail: true,
  severity: true,
  status: true,
  firstSeenAt: true,
  lastSeenAt: true,
} as const;

function normalizeAlert(row: PersistedAlert): ObservabilityAlert {
  if (row.severity !== "WARNING" && row.severity !== "CRITICAL") {
    throw new Error("INVALID_OBSERVABILITY_HEALTH_ALERT_SEVERITY");
  }
  return Object.freeze({
    id: row.id,
    fingerprint: row.fingerprint,
    source: row.source,
    title: row.title,
    detail: row.detail ?? "",
    severity: row.severity,
    status: row.status,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  });
}

const alertStore: ObservabilityAlertStore = {
  async findActive(fingerprint) {
    const row = await db.observabilityAlert.findFirst({
      where: {
        fingerprint,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        severity: { in: ["WARNING", "CRITICAL"] },
      },
      select: alertSelection,
    });
    return row ? normalizeAlert(row) : null;
  },
  async refresh(input) {
    await db.observabilityAlert.update({
      where: { id: input.id },
      data: {
        lastSeenAt: input.lastSeenAt,
        detail: input.detail,
        metadata: JSON.parse(JSON.stringify(input.metadata)),
      },
    });
  },
  async create(input) {
    const row = await db.observabilityAlert.create({
      data: {
        fingerprint: input.fingerprint,
        source: input.source,
        title: input.title,
        detail: input.detail,
        severity: input.severity,
        metadata: JSON.parse(JSON.stringify(input.metadata)),
        firstSeenAt: input.firstSeenAt,
        lastSeenAt: input.lastSeenAt,
      },
      select: alertSelection,
    });
    return normalizeAlert(row);
  },
  async list() {
    const rows = await db.observabilityAlert.findMany({
      where: { severity: { in: ["WARNING", "CRITICAL"] } },
      orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
      take: 100,
      select: alertSelection,
    });
    return rows.map(normalizeAlert);
  },
};

export function collectObservability(): Promise<ObservabilitySnapshot> {
  return collectPlatformObservability({ sources: [hostOperationalSource] });
}

export function listAlerts() {
  return alertStore.list();
}

export function syncObservabilityAlerts(snapshot: ObservabilitySnapshot) {
  return syncPlatformObservabilityAlerts({ snapshot, store: alertStore });
}
