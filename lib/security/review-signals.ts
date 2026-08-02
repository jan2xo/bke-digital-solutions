import type { SecurityEventType, SecurityEventSeverity } from "@/generated/prisma/client";

type Event = { type: SecurityEventType; severity: SecurityEventSeverity; createdAt: Date };
export function deriveSecurityReviewSignals(events: Event[]) {
  const since = Date.now() - 24 * 60 * 60_000;
  const recent = events.filter((event) => event.createdAt.getTime() >= since);
  const signals: { level: "review" | "attention"; title: string; detail: string }[] = [];
  const failed = recent.filter((event) => ["ADMIN_LOGIN_FAILED", "ADMIN_PASSWORD_REJECTED", "MFA_CHALLENGE_FAILED"].includes(event.type)).length;
  if (failed >= 3) signals.push({ level: "attention", title: "Repeated authentication failures", detail: `${failed} failed administrator authentication events were recorded in the last 24 hours. Review the timeline.` });
  if (recent.some((event) => event.type === "MFA_RECOVERY_USED")) signals.push({ level: "review", title: "Recovery code used", detail: "A recovery code was used recently. Confirm that this was expected." });
  if (recent.some((event) => event.type === "PROVIDER_VALIDATION_FAILED")) signals.push({ level: "review", title: "Provider validation failure", detail: "A provider validation failed recently. Review provider configuration without exposing credentials." });
  if (recent.some((event) => event.severity === "CRITICAL")) signals.push({ level: "attention", title: "Critical security event", detail: "A critical event was recorded. Review the event details and audit trail." });
  return signals;
}
