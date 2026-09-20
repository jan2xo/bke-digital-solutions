# Security event catalog

Security events use stable enum identifiers and server-owned labels, outcomes, severity, and explanations. Request metadata is allowlisted; credentials, tokens, cookies, recovery codes, raw payment/email payloads, raw user agents, complete IP addresses, and customer personal data are forbidden.

| Family | Examples | Typical severity |
| --- | --- | --- |
| Administrator login | password accepted/rejected, MFA success/failure, login success | low to medium |
| Session lifecycle | created, one revoked, other sessions revoked, all sessions revoked | low to high |
| MFA and recovery | enrollment, disablement, recovery use/regeneration | medium to high |
| Password | change and reset completion | high |
| Abuse control | security rate limit triggered | medium |
| Providers | credential replacement/revocation, validation success/failure | low to high |
| Live-payment guard | forbidden live enablement blocked | critical |
| Customer retention | lifecycle change and final purge | high to critical |
| Storage integrity | cleanup exhausted retries | high |

Phase 6.1 adds `CUSTOMER_LIFECYCLE_CHANGED`, `CUSTOMER_PURGE_EXECUTED`, and `STORAGE_CLEANUP_FAILED`. Audit logs contain the detailed normalized operation while security events contain only allowlisted action/count metadata. Neither channel stores object keys, prior customer email, raw error text, license material, or provider payloads.

Outcomes are `SUCCESS`, `FAILURE`, `BLOCKED`, or `INFORMATIONAL`. Severity is `INFORMATIONAL`, `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. Unknown historical types use a generic safe presentation. Filters are allowlisted before they reach Prisma.
# Scheduler operational audit events

Scheduler actions use redacted `AuditLog` records rather than customer-facing security payloads: `SCHEDULER_JOB_ENABLED`, `SCHEDULER_JOB_DISABLED`, `SCHEDULER_MANUAL_RUN_REQUESTED`, `SCHEDULER_DRY_RUN_REQUESTED`, `SCHEDULER_JOB_SUCCEEDED`, `SCHEDULER_JOB_FAILED`, `SCHEDULER_JOB_RETRY_SCHEDULED`, `SCHEDULER_JOB_RETRY_REQUESTED`, `SCHEDULER_JOB_ABANDONED`, `SCHEDULER_FAILURE_ACKNOWLEDGED`, and `SCHEDULER_LOCK_CONFLICT`. Routine successes are retained in `ScheduledJobRun`; only the registry jobs whose audit policy is `ALL`, and manual executions, add success audit records. Metadata is limited to job/run identifiers, trigger, attempt, failure class, and safe error code.
