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