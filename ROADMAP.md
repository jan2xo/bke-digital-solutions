# BKE Digital Solutions Roadmap

Cross-repository master plan: [docs/roadmaps/master-completion-roadmap.md](docs/roadmaps/master-completion-roadmap.md).

Last synchronized: August 10, 2026

Phase 2 release/latest resolution correction is implemented. Phase 3 Product Verification & Supply-Chain Signing is **PASS (certified 2026-08-13)**; Phase 4 has not started.

Phase 6.7 Legal/Tax/Compliance Review is implemented technically with an administrator compliance register, but professional legal, DPO/privacy, accountant/BIR, and regulatory approvals remain pending.

Phase 6.8 Secure Software Supply Chain is technically implemented with SBOM/provenance generation and release evidence tracking. Signing certificates and malware scanning remain pending.

Phase 6.9 Production Release Management is technically implemented with controlled lifecycle transitions and approval evidence. It does not imply release signing, malware clearance, or production deployment approval.

This roadmap supersedes the earlier Phase 5 continuation plan. The verified current-state audit in [`TRUTHCHECK.md`](./TRUTHCHECK.md) is the authority for priorities and launch gates.

## Production MinIO remediation (certified)

The first VPS deployment exposed a fresh-install failure: production MinIO had no deterministic bucket/user/policy bootstrap, so readiness could fail while the service was healthy. The corrected `minio-init` path is bounded, idempotent, private, and fail-closed; it provisions only bucket-scoped application credentials and rejects broader direct or inherited/group permissions. Runtime integration coverage proves clean bootstrap, rerun, and both rejection cases. This repository result does not claim VPS deployment or cold-reboot evidence.

## Current position

- RM1/RM2 commercial licensing and signing-registry work is committed and pushed at `5156caa` (`feat(licensing): complete RM7/RM8 commercial licensing lifecycle`).
- The verified certification baseline for that commit is: 32 migrations current, Vitest 167 passed/6 credential-gated skipped, Playwright 11 passed, TypeScript passed, ESLint passed, production build passed, Compose/runtime healthy, and repository hygiene passed.
- Commercial lease issuance, lifecycle operations, registry-backed signing, rotation, historical key publication, and Licensing Agent boundary controls are implemented. The Agent remains the runtime verification and authorization authority.
- Live payments remain disabled. PayMongo/Resend production evidence, VPS deployment, restore certification, production malware scanning, signing certificates, and professional legal/privacy/tax approvals remain external gates.
- The next active milestone is **Phase 6.10 — Production Deployment & Certification**. Deploy only the explicitly approved commit `5156caa`, not arbitrary working-tree state.

## Current operational sequence (authoritative)

1. **6.10.0 Deployment baseline:** approved commit `5156caa`.
2. **6.10.1 VPS provisioning:** Hetzner/Ubuntu, SSH hardening, firewall, Docker, and Docker boot enablement.
3. **6.10.2 Production secrets:** environment, database, storage, signing-key references, PayMongo TEST, and Resend credentials; no secrets in Git.
4. **6.10.3 Persistent services:** PostgreSQL, Valkey, MinIO/private object storage, persistent volumes, scheduler, and backup worker.
5. **6.10.4 Cloudflare/Caddy/HTTPS:** DNS, origin routing, TLS, proxy headers, security headers, and firewall validation.
6. **6.10.5 Initial deployment:** build, migrations, startup, health/readiness, and admin/customer access.
7. **6.10.6 Provider certification:** PayMongo TEST checkout/webhooks/refunds/reconciliation and Resend production-domain delivery. PayMongo LIVE remains disabled pending owner approval.
8. **6.10.7 Backup/restore certification:** PostgreSQL and object-storage backup, offsite copy, integrity verification, and isolated restore drill with RPO/RTO evidence.
9. **6.10.8 Upgrade/rollback certification:** backup, fetch approved release, rebuild affected containers, migrate, verify, and rollback without losing persistent state.
10. **6.10.9 Failure/reboot recovery:** service restart, scheduler/backup recovery, Docker boot, cold VPS reboot, and persistent-volume recovery.
11. **6.10.10 Production certification:** record deployed commit/version, migrations, provider, restore, reboot evidence, and remaining external approvals.

Organization management and customer support remain optional pre-deployment workstreams (6.9 and 6.9A). The future service-account/public-client API follows production deployment as Phase 6.11.

## Priority definitions

- **Critical launch blocker:** required before public payments or production customer use.
- **High priority:** required for the relevant production service, market, or distribution channel.
- **Medium priority:** important platform expansion that may follow the initial controlled launch.
- **Optional:** does not block the initial browser-based individual-customer launch.

## Phase 6.0 — Runtime Parity & Certification Baseline

**Priority:** Critical launch blocker

### Objective

Establish one trustworthy version across Git, generated Prisma code, migrations, Docker images, and certification runtime.

### Scope

- Apply the missing Phase 5.3 migration to certification.
- Rebuild certification from the approved commit.
- Verify image, application, Prisma client, and database migration parity.
- Diagnose every stored `PAYMENT_MISMATCH` webhook failure.
- Verify runtime provider-source selection and safe deployment identity.
- Document the repeatable certification update, reset, and preservation procedures.

### Completion criteria

- Repository and certification report the same release and all migrations.
- Phase 5.3 session administration works in certification.
- Every historical webhook mismatch category is explained.
- Full regression, production build, migration, smoke, and health checks pass.

### Current verification

Committed and pushed as part of the verified baseline. The generated client is reproducible, the certification database is current at 32 migrations, deterministic unit/integration and browser suites pass, production builds pass, and dependency-loss readiness checks fail closed. Phase 6.0 does not enable live payments or establish overall production readiness.

## Phase 6.1 — Data Integrity & Safe Deletion

**Priority:** Critical launch blocker

**Implementation status:** Committed and pushed at `952e9e1`. Scheduling its durable cleanup and lifecycle work remains Phase 6.3.

### Objective

Protect commercial history and make PostgreSQL/object-storage deletion recoverable and consistent.

### Scope

- Replace unrestricted permanent customer deletion with account closure, retention, pseudonymization, legal hold, and governed purge semantics.
- Preserve legally and operationally required orders, payments, invoices, refunds, licenses, and audit evidence.
- Separate privacy deletion from financial-record retention.
- Replace irreversible in-transaction object deletion with an idempotent cleanup workflow.
- Add retryable storage-cleanup jobs and orphan tracking.
- Fix artifact-replacement cleanup.
- Formalize and enforce the account membership permission matrix.

### Completion criteria

- No ordinary admin workflow can erase required historical commerce.
- Storage failures cannot leave live database records pointing silently to deleted objects.
- Cleanup is idempotent, observable, and retryable.
- Membership roles enforce approved billing, licensing, device, and download boundaries.

## Phase 6.1A — Legal Document Management System

**Priority:** Critical commercial-launch foundation

**Implementation status:** Committed and pushed at `7763dd0`, with consent/navigation hardening at `e5c94f7`. Automated verification passed. Professional legal/privacy/tax approval remains Phase 6.7 and is not satisfied by the template system.

### Objective

Build the technical system for versioned legal documents and immutable customer acceptance before final professional review.

### Scope

- Manage Terms, Privacy Policy, EULA, Subscription Terms, Refund Policy, Cookie Policy, Support Policy, DPA, and product-specific addenda.
- Draft, review, publish, supersede, retire, and schedule effective versions.
- Use sanitized Markdown or restricted rich text; never permit arbitrary executable HTML.
- Make published document versions immutable.
- Record immutable consent with user/account, document version, timestamp, context, and safe request evidence.
- Require consent or reacceptance at registration, checkout, organization invitation, or other approved points.
- Provide recent-authenticated, audited administrator editing.

### Completion criteria

- Published versions cannot be overwritten.
- Historical acceptance remains linked to the exact accepted text.
- Consent is isolated by user/account and cannot be forged or rewritten.
- XSS, authorization, versioning, and concurrency tests pass.

## Phase 6.2 — PayMongo Certification

**Priority:** Critical public-payment blocker

**Implementation status:** Lifecycle implementation is committed at `a43cfc5`, with current evidence committed at `2bc8e82`. Genuine paid, refund, retrieval, persisted reconciliation, duplicate-paid-redelivery, and duplicate-refund-redelivery evidence passes. Genuine failed-payment, delayed delivery, out-of-order delivery, and raw fixture export remain provider-interactive or impractical and retain deterministic integration coverage. The owner approved this partial certification as sufficient for Phase 6.3. See the [Phase 6.2 report](docs/phase-reports/phase-6.2-paymongo-lifecycle-certification.md).

### Objective

Complete the genuine PayMongo sandbox lifecycle and define the controlled live-activation gate.

### Scope

- Successful hosted checkout and payment.
- Checkout-session and payment webhook variants.
- Failed payment, full refund, duplicate refund, duplicate and delayed delivery, and out-of-order events.
- Cancellation followed by late authoritative payment.
- Amount, currency, reference, checkout/payment ID, and live/test mismatch rejection.
- Stale/invalid signatures, malformed payloads, processing retry, and provider reconciliation.
- Admin-visible reconciliation and governed manual-resolution procedure.
- Evidence retention without secrets, raw payloads, or customer data.

### Completion criteria

- Every required scenario passes with genuine sandbox evidence.
- Duplicate delivery issues exactly one entitlement.
- Failed/mismatched payments issue no entitlement.
- Refund revokes access once.
- Live payments remain disabled pending a separate owner approval.

## Phase 6.3 — Scheduler & Lifecycle Automation

**Priority:** Critical subscription-launch blocker

**Implementation status:** Committed and pushed at `099fe7c`, with the PostgreSQL interactive-transaction serialization correction at `66f9fdd`. Migration 20 is current in development and certification; eight typed jobs use Valkey ownership locks and database idempotency. Phase 6.4 builds on this committed scheduler.

### Objective

Make email, renewal, expiration, reservation, and cleanup workflows automatic, idempotent, and observable.

### Scope

- Schedule email outbox processing.
- Implement and deliver renewal reminders.
- Process subscription, license, and trial expiration.
- Add trial-ending and expiration notifications.
- Recover safely abandoned promotional reservations.
- Run storage-cleanup jobs introduced in Phase 6.1.
- Add job retry, deduplication, timeout, dead-letter, and manual recovery behavior.

### Completion criteria

- Each job has a schedule, owner, retry policy, and operational evidence.
- Renewal reminders are genuinely delivered once per intended reminder.
- Delayed schedulers cannot silently preserve expired access.
- Concurrent and repeated job execution is safe.

## Phase 6.4 — Backup & Disaster Recovery

**Priority:** Critical production-launch blocker

**Implementation status:** Implemented in the current uncommitted working tree with migration 21, pending owner review. TypeScript, ESLint, 155 Vitest cases, 11 Playwright cases, production build, migration/smoke, Docker image build, hygiene, and the zero-vulnerability runtime audit pass. A final Docker/certification refresh after the last small safety adjustments remains required because the execution environment exhausted its external-operation quota. The first genuine certification archive correctly refused certification because five database-referenced objects are absent from certification MinIO. Repairing that storage drift, completing a full restore simulation, provisioning production offsite credentials and separate key escrow, and running a production-sized restore drill remain launch gates.

### Objective

Create encrypted, offsite, verified, and restorable PostgreSQL and MinIO backups.

### Scope

- PostgreSQL and MinIO backup strategies.
- Encryption in transit and at rest with separate backup keys.
- Offsite copies and environment isolation.
- Daily, weekly, and monthly retention policy.
- Integrity verification and failure alerts.
- Restore order and documentation for database, storage, application, provider settings, and secrets.
- Defined and measured RPO/RTO.

### Completion criteria

- A complete encrypted backup succeeds.
- An isolated restore drill succeeds and validates commerce, licensing, and artifact checksums.
- Failure detection and owner-facing restore documentation are operational.

## Phase 6.5 — Monitoring & Observability

Current working-tree implementation adds the administrator health dashboard, typed metrics endpoint, and durable internal alert acknowledgement/resolution. It consumes existing services and preserves the external Licensing Agent boundary. Verification and migration deployment are pending owner review; Phase 6.6 remains blocked until this phase is reviewed.

**Priority:** Critical production-launch blocker

### Objective

Make application, provider, security, scheduler, database, Valkey, storage, and backup failures visible and actionable.

### Scope

- Structured redacted logs and correlation IDs.
- Request latency/error metrics.
- Login, MFA, rate-limit, checkout, webhook, reconciliation, outbox, scheduler, database, Valkey, MinIO, cleanup, and backup metrics.
- External health monitoring and severity-based alerts.
- Log retention and access policy.
- Provider and infrastructure outage playbooks.

### Completion criteria

- Simulated critical failures generate actionable, deduplicated alerts.
- Alerts identify the environment and correlation ID without sensitive data.
- Payment/webhook and infrastructure failures cannot remain silent.

## Phase 6.6 — Operations & Security Hardening

**Priority:** Critical production-launch blocker

### Objective

Harden containers, networks, hosts, secrets, administrator recovery, and incident response.

### Scope

- Pin and review container versions.
- Use non-root containers, minimal capabilities, read-only filesystems, and segmented networks where practical.
- Firewall and SSH key-only policy; disable direct root/password SSH.
- Patch and dependency-management process.
- Secret generation, access, rotation, revocation, and environment isolation.
- Verify distributed rate limits across multiple instances.
- Administrator recovery for lost MFA, exhausted codes, compromised sessions, password loss, and lost encryption keys.
- Incident response for payment compromise, credential leaks, account takeover, malware, breach, and data loss.
- Independent security review and remediation gate.

### Completion criteria

- No unnecessary service is public.
- Secret rotation and administrator recovery drills succeed.
- Incident roles and escalation paths are approved.
- No unresolved critical security or runtime dependency vulnerability remains.

## Phase 6.7 — Legal Review, Privacy, Tax & Compliance

**Priority:** Critical commercial-launch blocker

### Objective

Professionally review and approve the documents, retention policies, privacy operation, and tax/BIR position supported by Phase 6.1A.

### Scope

- Internal legal draft review.
- Privacy/data-processing review and data inventory.
- Retention, access, correction, export, deletion, breach, and subprocessor procedures.
- Cookie classification and consent determination.
- Organization controller/processor responsibilities.
- Accounting and Philippine tax/BIR review.
- VAT/non-VAT and official-invoice decisions.
- External legal review, owner approval, publication, and periodic review schedule.

### Completion criteria

- Required documents and policies are professionally reviewed and owner-approved.
- Privacy retention matches Phase 6.1 deletion behavior.
- Checkout records the approved applicable versions.
- The platform makes no unsupported BIR/tax-compliance claim.

## Phase 6.8 — Secure Software Supply Chain

**Priority:** Critical desktop-deployment blocker

### Objective

Prevent public distribution of unscanned, unsigned, or tampered installers.

### Scope

- Quarantine new uploads.
- Malware scanning and fail-closed publication.
- Scan history, engine version, definition time, retries, and manual review.
- Windows signing, Apple Developer ID signing/notarization, and applicable Linux signing.
- Signing-key protection outside the application database.
- Post-upload signature and checksum verification.
- Emergency artifact revocation and customer notification workflow.

### Completion criteria

- No production installer publishes without a required clean scan.
- Production installers are signed and independently verified.
- Compromised or superseded artifacts can be revoked safely.

## Phase 6.9 — Organization & Membership Management

**Priority:** High

### Objective

Expose the existing organization, invitation, membership, billing, and license-management model safely to customers.

### Scope

- Organization creation and profile management.
- Invite, resend, expire, accept, and revoke invitations.
- Owner, billing, license-manager, and member administration.
- Owner transfer, leave/remove member, and last-owner protection.
- Organization account switching and audit history.
- Authorized-user/seat assignment.
- Organization suspension and closure.

### Completion criteria

- Complete browser workflows exist.
- Cross-organization isolation and role boundaries pass.
- No member can escalate privileges or access unauthorized financial/license data.

## Phase 6.9A — Customer Support Platform (optional pre-deployment workstream)

**Priority:** High for public launch

### Objective

Provide private, auditable customer support rather than relying only on a configured email address.

### Scope

- Authenticated tickets for account, payment, refund, invoice, license, device, download, and security issues.
- Ticket state, priority, assignment, replies, history, and notifications.
- Safe account/order/license context.
- Private attachments integrated with malware scanning.
- SLA and escalation rules based on the approved Support Policy.
- Separate handling for security reports and feature requests.

### Completion criteria

- Customers can create and follow requests.
- Administrators can triage, reply, escalate, and resolve.
- Ticket content and attachments are isolated, retained, and audited correctly.

## Historical readiness-review gate (superseded by the 6.10.10 certification gate)

**Priority:** Mandatory go/no-go gate

### Objective

Perform an evidence-based approval review before creating the production VPS deployment.

### Required evidence

- Runtime/schema parity.
- Safe deletion and retention behavior.
- Complete PayMongo sandbox certification.
- Genuine Resend delivery.
- Scheduler and lifecycle automation.
- Successful backup and restore drill.
- Operational monitoring and alerts.
- Secret rotation and administrator recovery drills.
- Legal, privacy, refund, support, and tax approvals.
- Malware scanning and code signing for distributed software.
- Full automated test and production-build results.
- Runtime dependency audit with no unresolved critical issue.
- Independent security review findings and disposition.
- Owner-approved launch scope, rollback conditions, and accepted residual risks.

### Completion criteria

- Every applicable blocker is passed, explicitly deferred as out of launch scope, or rejected.
- No test or provider scenario is represented as passed without evidence.
- Owner records a formal go/no-go decision.

## Historical Phase 6.11 — VPS Production Deployment (superseded by current Phase 6.10)

**Priority:** Critical production-launch blocker

### Objective

Deploy the approved platform to a hardened VPS and validate it under production networking and operations.

### Dependencies

- The 6.10 deployment and certification gates must pass.

### Scope

- Provision and harden the VPS.
- Deploy the approved Docker/Caddy stack.
- Configure Cloudflare DNS and HTTPS.
- Configure PostgreSQL, Valkey, and private S3-compatible storage.
- Apply migrations using the controlled release workflow.
- Enable backups, schedulers, monitoring, and alerting.
- Validate trusted origins, proxy headers, and service isolation.
- Execute deployment, rollback, restart, outage, and restore tests.
- Keep PayMongo live mode disabled until the separate owner activation decision.

### Completion criteria

- Deployment and rollback are repeatable.
- Public HTTPS and security headers pass.
- No internal database/cache/storage port is public.
- Backups, scheduler, alerts, and restore operate on the VPS.
- Production runbook and owner handoff are complete.

## Phase 6.11 — Service Accounts & Public Client API (post-deployment)

**Priority:** Medium; required for external BKE client integrations

### Objective

Provide versioned, scoped, revocable machine access for BKE desktop, cloud, and service integrations.

### Scope

- Versioned `/api/v1` contracts.
- Service accounts and scoped credentials.
- Hashed keys with one-time disclosure, expiry, rotation, and revocation.
- Account, environment, product, and operation scopes.
- License validation, activation/deactivation, feature entitlement, and update-eligibility APIs.
- Replay protection, per-credential rate limits, and security events.
- Client SDK contract and integration examples.
- No global server secret embedded in distributed clients.

### Completion criteria

- A real client authenticates and completes validation/activation safely.
- Cross-account/product scopes fail closed.
- Credentials are revocable, rotatable, auditable, and versioned.

## Dependency and parallelization summary

```text
Phase 5.3 complete
        |
        v
6.0 Runtime parity (complete)
        |
        +------> 6.1 Data integrity (next)   6.1A Legal system (complete)
        |               |                         |
        +------> 6.2 PayMongo                     v
        +------> 6.3 Scheduler              6.7 Legal review
        +------> 6.4 Backup                       |
        |                                         +------> 6.9 Organizations / 6.9A Support
        +------> 6.5 Monitoring ------------------+
                        |
                        v
                 6.6 Operations hardening
                        |
                        +------> 6.8 Supply chain
                        |
                        v
                6.10 Production deployment & certification
                        |
                        v
                 6.11 Public client API
                        |
                        v
```

After Phase 6.0, Phases 6.1, 6.2, 6.3, and 6.4 can overlap. Monitoring should begin alongside them and integrate their final signals. Legal drafting and signing-certificate acquisition should start early because external review can add calendar time.

## Launch gates

### Public payments are blocked by

- 6.0 through 6.7, the 6.10 deployment/certification gates, and the owner go/no-go decision.

### Production desktop distribution is blocked by

- 6.1, 6.5, 6.6, 6.7, 6.8, and the applicable 6.10 deployment/certification gates.
- 6.11 also blocks desktop products that require ongoing public API validation.

### Optional for an initial individual browser-only launch

- 6.9 organization management.
- 6.11 public client API when no external client is shipping.
- Advanced support features beyond an approved operational support workflow.

## Recommended execution order

1. Completed: 6.0 Runtime parity and 6.1A Legal document system.
2. Next: 6.1 Data integrity; start legal retention consultation.
3. Then: 6.2 PayMongo and 6.3 scheduler in parallel.
4. 6.4 backup and 6.5 monitoring in parallel.
5. 6.6 operations hardening.
6. 6.7 legal/privacy/tax approval.
7. 6.8 secure supply chain.
8. 6.9 organizations and 6.9A support according to launch scope.
9. 6.10 production deployment and certification using approved commit `5156caa`.
10. 6.11 client API when a real integration is ready.

No phase is complete until implementation, tests, documentation, security review, and repository consistency have been verified according to `CORE-INSTRUCTION.md`.

The independent Phase 6.10 VPS guide is available at `docs/vps-production-deployment.md`; actual deployment and reboot certification remain owner-operated.

## Historical RM remediation (completed before current Phase 6.10)

Repository controls are implemented locally: signed commercial lease issuance, evidence-backed supply-chain verification, fail-closed release gates, separation of duties, grant recovery, and administrator navigation. Compatibility certification against the separate Licensing Agent, production signing/scanning, professional review, backup restore certification, and Phase 6.10 infrastructure remain pending.

## RM3 — Release Governance & Separation of Duties

Status: **IMPLEMENTED LOCALLY**. Stable/LTS promotion requires prior independent review, rejects self-approval, records approval notes and audit events, enforces forward-only lifecycle transitions, and supports an explicitly enabled, justified, audited break-glass path. Full production certification remains pending.


## Version 7 — Compliance Review Center

After production release, expand the current Compliance Readiness dashboard into a complete workflow-driven Compliance Review Center.

This is a feature enhancement, not a Phase 6 production-readiness requirement.

### Goals

Transform compliance from passive status tracking into a complete review and approval workflow.

### Features

#### Compliance Review Center

The Compliance dashboard becomes the central workspace for all legal, privacy, tax, regulatory, and internal compliance reviews.

Each compliance item should support:

- assigned reviewer
- current workflow status
- document version
- review history
- approval history
- reviewer comments
- requested revisions
- evidence attachments
- immutable audit trail
- approval timestamps
- superseded versions
- archived history

---

### Legal Workflow

Implement structured review workflows for:

- Terms of Service
- Privacy Policy
- EULA
- Subscription Terms
- Refund Policy
- Cookie Policy
- Acceptable Use Policy
- Support Policy
- DPA
- Tax-related policies
- Future compliance documents

Typical workflow:

Draft
→ Internal Review
→ Sent for Review
→ Changes Requested
→ Approved
→ Published
→ Superseded
→ Archived

---

### Reviewer Assignment

Support assigning reviewers such as:

- Lawyer
- Privacy/DPO
- Accountant
- Regulatory Reviewer
- Owner
- Internal Reviewer

Assignments should record:

- assignee
- assigned date
- due date
- completion date

---

### Approval Timeline

Each compliance record should maintain an immutable timeline containing:

- who reviewed
- who approved
- approval date
- document version
- comments
- requested revisions
- publication date

---

### Version Comparison

Support viewing differences between document revisions.

Future capability:

- side-by-side comparison
- change summaries
- approval tied to a specific version

---

### Compliance Notifications

Future notification support for:

- pending review
- reviewer assignment
- approval completed
- changes requested
- publication
- expiring reviews
- scheduled policy review reminders

Notification providers may later include:

- Email
- Discord
- Telegram
- Future messaging providers

---

### Future Integrations

Potential integrations:

- Electronic approval records
- Digital signatures
- External legal review portals
- Automated reminder scheduling
- Policy expiration monitoring
- Compliance analytics
- Audit reporting

---

Status:

**Planned for Version 7**

Not required for Phase 6 production readiness.
### RM7 — Repository Certification Corrections (committed)

Current work corrects durable lease lifecycle progression, prevents break-glass
from bypassing integrity evidence, and separates supply-chain signer identity
from commercial licensing keys. Status: committed; static verification passes,
while database, Docker, and browser execution remains environment-dependent.
