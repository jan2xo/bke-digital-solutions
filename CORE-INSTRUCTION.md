# CORE-INSTRUCTION.md

# BKE Digital Solutions — Core Development Instructions

## Mission

BKE Digital Solutions is the central software commerce, licensing, distribution, and customer management platform for the BKE ecosystem.

Every implementation should strengthen the platform as a reusable foundation for future BKE desktop, web, cloud, and enterprise applications.

The repository is the single source of truth.

---

# Repository Continuity

Treat this repository as a living software project.

Every completed phase must leave the repository in a state where another developer can:

- Understand the architecture
- Build the application
- Run tests
- Deploy the platform
- Continue development

without relying on previous chat history.

Documentation is part of implementation.

A feature is not complete until implementation, testing, documentation, and project records are updated.

---

# Platform Philosophy

Blueprint first.

Architecture second.

Implementation third.

Always understand how a feature fits into the long-term platform before writing code.

Prefer reusable platform capabilities over product-specific implementations.

Avoid duplicate systems.

When two or more future products could reuse the same capability, implement it once as a shared platform component.

---

# Product Vision

BKE Digital Solutions is not a single-product website.

It is the central platform responsible for:

- Product management
- Software commerce
- Customer accounts
- Licensing
- Downloads
- Device management
- Product activation
- Software updates
- Audit history
- Administration
- Future desktop licensing
- Future API integrations

Future BKE applications such as:

- AIRSTACK
- WeatherWatch
- Broadcast Operations Suite
- Future desktop applications

must integrate with this platform rather than implementing independent commerce or licensing systems.

---

# Commerce Principles

Products may contain one or more Editions.

Each Edition may expose one or more Purchase Plans.

Supported purchase plans include:

- Perpetual (One-time Purchase)
- Monthly Subscription
- Annual Subscription

The platform must support any valid combination of these plans.

Example:

AIRSTACK Professional

- Perpetual
- Monthly
- Annual

The same Edition owns the software capabilities.

Purchase Plans own only:

- payment model
- billing interval
- pricing
- renewal behavior
- entitlement duration

Never duplicate feature definitions across purchase plans.

Annual subscriptions must derive their pricing from the Monthly plan.

Annual discounts:

Minimum:

0%

Maximum:

10%

The server is always authoritative for pricing.

Never trust prices, discounts, or billing intervals submitted by the client.

---

# Licensing Philosophy

Licensing belongs to the platform.

Products consume licensing services.

No application should implement an independent licensing system.

Future desktop applications will integrate through the shared BKE Licensing API and Licensing Client SDK.

The licensing platform is responsible for:

- Activation
- Validation
- Device registration
- Device limits
- License lifecycle
- Update eligibility
- Feature entitlements
- Future offline licensing

---

# Security Principles

Security is a platform feature.

Never weaken existing protections.

Never expose:

- Secrets
- API keys
- Tokens
- Private credentials
- Customer information
- Private storage

Never bypass:

- ADMIN authorization
- Same-origin validation
- Audit logging
- Customer isolation
- License protection
- Safe product deletion

Browser state is never authoritative.

The server validates all critical business operations.

---

# Data Integrity

Historical data must remain immutable.

Future product, pricing, licensing, or subscription changes must never silently modify historical:

- Orders
- Invoices
- Payments
- Licenses
- Downloads
- Audit records

Snapshots should represent the state of the transaction at the time it occurred.

---

# Verification Policy

Never report work as completed unless it has been verified.

Never claim tests passed unless they were actually executed.

Clearly distinguish:

- Passed
- Failed
- Blocked
- Skipped
- Credential-dependent
- Not Implemented

---

# Documentation Policy

Every significant implementation must update the appropriate documentation.

When applicable, update:

- ROADMAP.md
- Architecture
- Implementation Status
- Developer Journal
- Phase Reports
- Deployment Checklist
- Production Readiness Report
- Engineering Handoff

Every architecture decision, migration, feature, blocker, failure, fix, security decision, and next action should be documented.

---

# Development Workflow

Before implementing any feature:

1. Review this document.
2. Review ROADMAP.md.
3. Review Architecture documentation.
4. Review current Phase documentation.
5. Review existing implementations.
6. Extend existing systems whenever possible.

After implementation:

- Execute verification.
- Update documentation.
- Review repository consistency.
- Review production impact.
- Summarize remaining blockers.

---

# Completion Criteria

A development phase is complete only when:

✓ Implementation is complete.

✓ Tests have been executed.

✓ Documentation has been updated.

✓ Repository consistency has been reviewed.

✓ Security has not regressed.

✓ Historical data remains protected.

✓ Another developer can continue the project without relying on previous chat history.

---

# Guiding Principle

Build platforms, not features.

Every implementation should make the next BKE product easier to build, integrate, deploy, license, and maintain.

Every phase must end in a deployable, documented, testable, production-progressing state. No phase may introduce unfinished architecture that blocks subsequent phases. Documentation, roadmap, architecture, developer journal, implementation status, and handoff documents must be updated before a phase is considered complete.


---

# Intent-Driven PR-Owned GitHub Certification

This repository uses a **stable trusted comment-triggered entrypoint** and **editable PR-owned certification plans**.

- The registered `.github/workflows/certify.yml` dispatcher must be available on the default branch so GitHub can receive `/certify ...` PR comments. Its presence on `main` does **not** make `main` the only place where tests may be authored.
- Each PR may add its own tests and `.github/pr-certification/pr-NNN.json` file on its branch. That file declares its exact `requiredTargets` and specific test files. PR numbers identify one-off test ownership, e.g. `PR #297`; stable shared module workflow names must remain behavior-oriented.
- The trusted dispatcher resolves the **exact current PR head SHA**, reads the PR's manifest from that SHA, verifies its declared proof graph, and runs only explicitly selected modules. It rejects incomplete graphs, conflicting PR numbers, stale heads and unauthorized certification triggers.
- The PR-owned test executor is **unprivileged**: no secret-bearing environment, no OIDC token, no write authorization, and no persisted checkout credential. A PR must never gain production or Staging authority by editing its test plan.
- Each active workflow has a single behavioral certification responsibility. Heavy CI must not start merely from opening, synchronizing or pushing a PR. `required-certification` aggregates only required exact-head proof; it is not an indiscriminate launcher.
- A temporary PR-owned workflow or test recipe is **retired to an inert legacy archive** after its intent is merged or its proof is incorporated into a durable shared module. Archive the original source, remove it from active Actions, and adjust contract tests to reflect ownership. Never retire a workflow that is still referenced as an active certification owner.
- Privileged Staging, live checkout, production databases, signing and releases remain separate explicit operations with their own trusted authorization, locked environment, immutable source and purpose-bound permissions.
- Before a SHA-locked merge, require a current-head PASS for every declared certification target. If CI bootstrap is blocked, preserve a PR checkpoint and identify the exact blocker; never substitute stale CI results for exact-head proof.

See `.github/workflows/README.md` and `docs/operations/CI-CORE-OIDC-ISOLATION-20261109.md` for implementation ownership and the CI startup failure record.
