export type SecurityPresentationOutcome = "SUCCESS" | "FAILURE" | "BLOCKED" | "INFORMATIONAL";
export type SecurityPresentationSeverity = "INFORMATIONAL" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface SecurityEventDefinition {
  readonly label: string;
  readonly outcome: SecurityPresentationOutcome;
  readonly severity: SecurityPresentationSeverity;
  readonly explanation: string;
}

const defaults: SecurityEventDefinition = {
  label: "Security activity",
  outcome: "INFORMATIONAL",
  severity: "LOW",
  explanation: "An administrator security action was recorded.",
};

const definitions: Readonly<Record<string, SecurityEventDefinition>> = Object.freeze({
  ADMIN_LOGIN_SUCCEEDED: { label: "Administrator signed in", outcome: "SUCCESS", severity: "LOW", explanation: "A password and MFA protected administrator sign-in completed." },
  ADMIN_LOGIN_FAILED: { label: "Administrator sign-in failed", outcome: "FAILURE", severity: "MEDIUM", explanation: "An administrator sign-in attempt did not complete." },
  ADMIN_PASSWORD_REJECTED: { label: "Administrator password rejected", outcome: "FAILURE", severity: "MEDIUM", explanation: "A password attempt for an administrator account was rejected." },
  ADMIN_SESSION_CREATED: { label: "New administrator session", outcome: "SUCCESS", severity: "LOW", explanation: "A new authenticated administrator session was created." },
  ADMIN_SESSION_REVOKED: { label: "Session revoked", outcome: "SUCCESS", severity: "MEDIUM", explanation: "An administrator session was explicitly revoked." },
  ADMIN_ALL_OTHER_SESSIONS_REVOKED: { label: "Other sessions revoked", outcome: "SUCCESS", severity: "HIGH", explanation: "All other administrator sessions were revoked." },
  ADMIN_ALL_SESSIONS_REVOKED: { label: "All sessions revoked", outcome: "SUCCESS", severity: "HIGH", explanation: "Every administrator session, including the current one, was revoked." },
  MFA_CHALLENGE_FAILED: { label: "MFA challenge failed", outcome: "FAILURE", severity: "MEDIUM", explanation: "An administrator MFA challenge was rejected." },
  MFA_CHALLENGE_SUCCEEDED: { label: "MFA challenge succeeded", outcome: "SUCCESS", severity: "LOW", explanation: "An administrator MFA challenge completed." },
  MFA_RECOVERY_USED: { label: "Recovery code used", outcome: "SUCCESS", severity: "HIGH", explanation: "An administrator recovery code was used to authenticate." },
  MFA_DISABLED: { label: "Administrator MFA disabled", outcome: "SUCCESS", severity: "HIGH", explanation: "Administrator MFA was disabled and must be enrolled again." },
  MFA_ENROLLED: { label: "Administrator email verification enabled", outcome: "SUCCESS", severity: "MEDIUM", explanation: "Administrator password-plus-email verification was enabled." },
  MFA_RECOVERY_REGENERATED: { label: "Recovery codes regenerated", outcome: "SUCCESS", severity: "HIGH", explanation: "Existing recovery codes were replaced." },
  PASSWORD_CHANGED: { label: "Administrator password changed", outcome: "SUCCESS", severity: "HIGH", explanation: "The administrator password changed and sessions were revoked." },
  PASSWORD_RESET_COMPLETED: { label: "Administrator password reset", outcome: "SUCCESS", severity: "HIGH", explanation: "A password reset completed for an administrator account." },
  SECURITY_RATE_LIMIT_TRIGGERED: { label: "Security rate limit triggered", outcome: "BLOCKED", severity: "MEDIUM", explanation: "Repeated security requests were temporarily blocked." },
  PROVIDER_CREDENTIAL_REPLACED: { label: "Provider credential replaced", outcome: "SUCCESS", severity: "HIGH", explanation: "An encrypted external-provider credential was replaced." },
  PROVIDER_CREDENTIAL_REVOKED: { label: "Provider credential revoked", outcome: "SUCCESS", severity: "HIGH", explanation: "An external-provider credential was revoked." },
  PROVIDER_VALIDATION_SUCCEEDED: { label: "Provider validation succeeded", outcome: "SUCCESS", severity: "LOW", explanation: "External-provider configuration validation completed." },
  PROVIDER_VALIDATION_FAILED: { label: "Provider validation failed", outcome: "FAILURE", severity: "MEDIUM", explanation: "External-provider configuration validation failed." },
  LIVE_PAYMENT_ENABLE_BLOCKED: { label: "Live payment enablement blocked", outcome: "BLOCKED", severity: "CRITICAL", explanation: "A forbidden live-payment enablement attempt was blocked." },
  CUSTOMER_LIFECYCLE_CHANGED: { label: "Customer lifecycle changed", outcome: "SUCCESS", severity: "HIGH", explanation: "An administrator changed customer access, retention, privacy, or legal-hold state." },
  CUSTOMER_PURGE_EXECUTED: { label: "Customer purge executed", outcome: "SUCCESS", severity: "CRITICAL", explanation: "An eligible pseudonymized customer record was irreversibly purged." },
  STORAGE_CLEANUP_FAILED: { label: "Storage cleanup failed", outcome: "FAILURE", severity: "HIGH", explanation: "A durable private-storage cleanup job exhausted its automatic retries." },
});

export function securityEventDefinition(type: string): SecurityEventDefinition {
  return definitions[type] ?? defaults;
}

export interface SecurityReviewEvent {
  readonly type: string;
  readonly severity: string;
  readonly createdAt: Date;
}

export interface SecurityReviewSignal {
  readonly level: "review" | "attention";
  readonly title: string;
  readonly detail: string;
}

export function deriveSecurityReviewSignals(events: readonly SecurityReviewEvent[]): readonly SecurityReviewSignal[] {
  const since = Date.now() - 24 * 60 * 60_000;
  const recent = events.filter((event) => event.createdAt.getTime() >= since);
  const signals: SecurityReviewSignal[] = [];
  const failed = recent.filter((event) =>
    ["ADMIN_LOGIN_FAILED", "ADMIN_PASSWORD_REJECTED", "MFA_CHALLENGE_FAILED"].includes(event.type),
  ).length;
  if (failed >= 3) {
    signals.push({
      level: "attention",
      title: "Repeated authentication failures",
      detail: `${failed} failed administrator authentication events were recorded in the last 24 hours. Review the timeline.`,
    });
  }
  if (recent.some((event) => event.type === "MFA_RECOVERY_USED")) {
    signals.push({
      level: "review",
      title: "Recovery code used",
      detail: "A recovery code was used recently. Confirm that this was expected.",
    });
  }
  if (recent.some((event) => event.type === "PROVIDER_VALIDATION_FAILED")) {
    signals.push({
      level: "review",
      title: "Provider validation failure",
      detail: "A provider validation failed recently. Review provider configuration without exposing credentials.",
    });
  }
  if (recent.some((event) => event.severity === "CRITICAL")) {
    signals.push({
      level: "attention",
      title: "Critical security event",
      detail: "A critical event was recorded. Review the event details and audit trail.",
    });
  }
  return Object.freeze(signals);
}
