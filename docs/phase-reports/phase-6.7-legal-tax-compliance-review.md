# Phase 6.7 — Legal, Tax & Compliance Review

Phase 6.7 adds a structured, auditable compliance register at `/admin/compliance`. Requirements distinguish implementation evidence from decisions and professional review. The system never represents a pending review as approval.

Implemented technical controls include versioned legal documents and immutable consent, retention/legal-hold/pseudonymization gates, preservation of commerce and audit evidence, and administrator-only compliance status/evidence changes protected by recent authentication, same-origin validation, rate limiting, and audit events.

Seeded statuses explicitly distinguish `IMPLEMENTED`, `PENDING_OWNER_DECISION`, `PENDING_LAWYER_REVIEW`, `PENDING_ACCOUNTANT_REVIEW`, `PENDING_DPO_REVIEW`, and `PENDING_REGULATORY_APPROVAL`.

Professional review remains pending: counsel must approve Terms, EULA, subscription, refund, privacy, DPA, cookie, support, and licensing language; a DPO/privacy reviewer must approve lawful basis, notices, processors, rights, and retention; and an accountant/tax professional must approve Philippine tax treatment, commercial invoices, records, and BIR readiness. No approval is fabricated.
