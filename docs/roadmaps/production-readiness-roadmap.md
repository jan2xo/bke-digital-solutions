# BKE Digital Solutions
# Production Readiness Roadmap (Post SOL Independent Audit)

**Source:** SOL Phase 6.11 Independent Repository Audit

**Purpose**

This roadmap is the engineering backlog produced from the independent audit.

Unlike the implementation roadmap, this roadmap exists solely to eliminate every remaining production blocker before BKE Digital Solutions is considered production-ready.

---

# Overall Status

Current Verdict:

❌ NOT PRODUCTION READY

Current Score:

44 / 100

---

# Priority Levels

P0 — Critical Production Blocker

Must be completed before production.

---

P1 — High Priority

Required before commercial release.

---

P2 — Medium Priority

Should be completed after production launch.

---

P3 — Nice to Have

Future engineering improvements.

---

# PHASE R1 — Licensing Platform Integration

Priority:

P0

Status:

Not Started

Reason:

The production licensing architecture documented in the repository is not yet integrated.

---

## R1.1 Remove Legacy Direct Authorization

Current issue

The commerce platform still exposes direct database authorization through:

```
/api/licenses/activate
```

Products must never authorize directly from the commerce database.

Required

- Remove legacy authorization flow
- Replace with Licensing Agent protocol
- Commerce issues signed leases only
- Products consume AuthorizationDecision only

---

## R1.2 Implement Signed Lease Issuance

Required

Production implementation of

- Ed25519 lease signing
- Lease key versioning
- Lease envelope generation
- Lease expiration
- Lease renewal
- Lease revocation

---

## R1.3 Licensing Agent Integration

Implement

Commerce

↓

Signed Lease

↓

Licensing Agent

↓

AuthorizationDecision

↓

Desktop Product

The commerce platform must never authorize products directly.

---

## R1.4 Production Protocol Verification

Verify

- Lease issuance
- Lease refresh
- Lease revocation
- Lease renewal
- Lease expiration
- Lease verification

---

# PHASE R2 — Release Integrity

Priority

P0

---

## R2.1 Cryptographic Signature Verification

Current issue

Administrators can mark signatures as verified without cryptographic proof.

Replace with

- detached signatures
- verification process
- immutable verification evidence

---

## R2.2 Malware Verification

Current issue

Malware status can be manually marked CLEAN.

Replace with

- scanner execution
- scanner identity
- scan timestamp
- immutable scan evidence

---

## R2.3 Release Gates

Stable / LTS must require

- verified signatures
- malware passed
- SBOM generated
- provenance generated
- migrations verified
- backup evidence
- compliance approval

No manual bypass.

---

## R2.4 Separation of Duties

Prevent one administrator from

- creating
- reviewing
- approving

the same release.

---

# PHASE R3 — Compliance Completion

Priority

P0

---

Replace placeholder documents

- Privacy Policy
- Terms
- EULA
- Refund Policy
- Subscription Terms
- Cookie Policy
- Support Policy
- DPA
- AUP

---

Record approvals

- Lawyer
- DPO
- Accountant
- Owner
- Regulatory

---

# PHASE R4 — Disaster Recovery Certification

Priority

P0

---

Repair object drift

Missing MinIO objects

↓

Complete backup

↓

Verification

↓

Restore Drill

↓

Recovery Certification

---

Required

- repair missing objects
- create complete backup
- isolated restore
- production-sized recovery
- RPO measurement
- RTO measurement

---

# PHASE R5 — Commerce Certification

Priority

P0

---

Complete genuine

PayMongo

- failed payment
- delayed webhook
- duplicate webhook
- replay attack
- refund
- cancellation

---

Complete

Resend

- production domain
- delivery verification
- bounce handling

---

# PHASE R6 — Testing Completion

Priority

P0

---

Fix

Current Playwright failure

---

Add regression coverage

Compliance

Supply Chain

Release Management

Release Gates

Signature Verification

Malware Verification

Licensing Integration

---

All tests must pass.

---

# PHASE R7 — Documentation Synchronization

Priority

P0

---

Synchronize

README

ROADMAP

TRUTHCHECK

Architecture

Implementation Status

Operations Runbook

Handoff

Phase Reports

No stale information.

---

# PHASE R8 — Administrator UX

Priority

P1

---

Expose

Compliance

Supply Chain

through administrator navigation.

---

# PHASE R9 — Observability Improvements

Priority

P1

---

Improve

Container health checks

Scheduler readiness

Worker readiness

Alert delivery

External monitoring

Pager integration

---

# PHASE R10 — Architecture Quality

Priority

P1

---

Refactor

Large route handlers

Large UI files

Improve readability

---

Add

dependency-cycle detection

---

# PHASE R11 — VPS Production Deployment

Priority

P0

Deferred until deployment

Owner Phase

---

Deploy

Hetzner VPS

---

Verify

Docker boot

Cloudflare

HTTPS

Firewall

Persistent volumes

Cold reboot

Health endpoints

Recovery

---

This phase requires

real infrastructure.

Repository evidence is insufficient.

---

# PHASE R12 — Live Provider Certification

Priority

P0

Deferred until production

---

Enable

Live PayMongo

Live Resend

---

Verify

real payments

real refunds

real invoices

real emails

---

# PHASE R13 — Security Hardening

Priority

P2

---

Implement

IP intelligence

Device reputation

VPN detection

Disposable email detection

Rate-based abuse detection

Velocity checks

---

Examples

Same IP

↓

Create

20 accounts

↓

Reject

---

Same IP

↓

Multiple trial requests

↓

Reject

---

Same IP

↓

Multiple discount abuse

↓

Reject

---

# PHASE R14 — Future Improvements

Priority

P3

---

Potential enhancements

- SIEM integration
- OpenTelemetry
- Prometheus
- Grafana
- Hardware Security Module (HSM)
- Automatic certificate rotation
- WORM backup storage
- Immutable audit archives
- Multi-region backup replication

---

# Success Criteria

Repository

✔ Licensing Agent integrated

✔ Release integrity enforced

✔ Compliance complete

✔ Recovery certified

✔ Commerce certified

✔ Documentation synchronized

✔ Regression suite green

↓

Infrastructure

✔ VPS deployed

✔ Cloudflare verified

✔ HTTPS verified

✔ Cold reboot verified

✔ Live providers verified

↓

Final SOL Audit

↓

PRODUCTION READY

---

# Notes

Items explicitly deferred until deployment:

- Hetzner VPS verification
- Cloudflare DNS verification
- Public HTTPS verification
- Cold reboot recovery
- Live PayMongo
- Live Resend

These require real production infrastructure and cannot be certified from repository evidence alone.

Phase 6.12 SOL tracking: legacy activation boundary **PARTIALLY RESOLVED** pending separate Agent compatibility certification; supply-chain self-attestation **RESOLVED** for repository controls; release gates **RESOLVED** server-side; separation of duties **RESOLVED**; download-grant reliability **RESOLVED**; VPS/provider/legal/recovery items remain **DEFERRED — PHASE 6.10** or **PENDING PROFESSIONAL REVIEW** as applicable.

Licensing boundary correction: **RESOLVED LOCALLY** — activation returns lease issuance only; Agent compatibility and end-to-end `AuthorizationDecision` evidence remain pending against the separate Agent repository.
## RM5 documentation truth

Current implementation and certification status is authoritative in
`TRUTHCHECK.md`. RM1–RM4 repository controls are implemented or locally
verified as stated there; external infrastructure and professional reviews are
not complete. Version 7 is a post-production enhancement and is not a Phase 6
production blocker.
## RM7 — Repository Certification Corrections (committed)

- RB1 lease lifecycle and product-version rejection: RESOLVED in repository code; database certification remains environment-blocked.
- RB2 governance-only break-glass with mandatory integrity evidence: RESOLVED.
- RB3 separate licensing and supply-chain signing identities and trusted-key history: RESOLVED in repository code; production key provisioning remains external.

RM7 dispositions: RB1 RESOLVED for Digital Solutions commercial issuance, RB2 RESOLVED, RB3 RESOLVED. Environment-blocked

RB1A — Renewal Integration: PARTIALLY RESOLVED. Confirmed renewal settlement
creates an evidence-linked idempotent commercial renewal operation and applies
the agreed early/expired expiry rule. PostgreSQL-backed certification of webhook
replay and active-device lease issuance remains environment-blocked.
database/browser/Docker checks and external production certifications remain open.

RB1B — Transfer Integration: PARTIALLY RESOLVED. Purchased-policy validation,
target evidence, commercial activation release, and idempotent operation creation
are implemented. Successor lease issuance and database-backed replay certification
remain environment-blocked.

RM8C — Commercial Signing-Key Rotation Workflow: PARTIALLY RESOLVED. Validated
administrator rotation, single-active-key enforcement, idempotent operations,
and retired-key publication are implemented. PostgreSQL concurrency and live
historical verification certification remain pending.

RB1C — Refresh Integration: PARTIALLY RESOLVED. Binding validation, durable
refresh operations, and successor issuance are implemented. No-change reuse and
database-backed concurrency certification remain environment-blocked.

RM8 — Commercial Signing Registry & Key Rotation: PARTIALLY IMPLEMENTED. The
registry schema, private-key reference boundary, bootstrap path, and historical
public-key publication are present. Active-key issuance integration and audited
rotation remain pending.

RB1D — Revocation Replacement Integration: PARTIALLY RESOLVED. Revocation is
durable and refusal-based; operation creation, device deactivation, and fail-
closed issuance are implemented. Database-backed replay and rollback evidence
remain environment-blocked.

RM7F — Commercial Lease Workflow Completion: PARTIALLY RESOLVED. Refresh reuse
and terminal revocation evidence are implemented. Renewal successor issuance and
transactionally authoritative transfer remain repository blockers; database
certification remains environment-blocked.

RM7G — Atomic Commercial Workflow Finalization: PARTIALLY RESOLVED. Transfer
now uses prepare/issue/reuse/finalize with durable recovery evidence. Renewal
without an active installation is terminal and explicit; bound-renewal successor
issuance is wired through the confirmed-payment workflow. Database certification
and retry-drill evidence remain pending.
## RM7H — Final licensing lifecycle corrections

Implemented in the current working tree: source-predecessor transfer lifecycle
and replay validation, material-change refresh decisions, bounded prepared-renewal
recovery, immutable signing-key rotation replay checks, and atomic rotation audit
evidence. Full PostgreSQL/browser certification remains environment-dependent.
