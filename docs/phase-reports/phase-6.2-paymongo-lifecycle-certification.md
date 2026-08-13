# Phase 6.2 — PayMongo Lifecycle Certification

Status: **Partially certified with provider-interactive cases remaining.** The owner approved this evidence level for Phase 6.3 entry.

## Executive verdict

The application has genuine PayMongo Test Mode evidence for hosted checkout creation, signed paid settlement, signed refund settlement, provider payment retrieval, persisted reconciliation, and dashboard-originated duplicate paid/refund redelivery. Deterministic PostgreSQL integration coverage verifies delayed, out-of-order, failed-payment, refund, replay-conflict, idempotency, and transactional entitlement behavior.

Phase 6.2 is not fully certified. A genuine failed checkout and PayMongo-originated delayed/out-of-order resend evidence still require owner interaction with PayMongo's hosted checkout and Dashboard. The project owner confirmed on 2026-08-13 that PayMongo is live and operational on the production VPS. That operational fact does not replace the missing repository-retained certification evidence.

## Genuine provider evidence

| Scenario | Result | Evidence |
| --- | --- | --- |
| Hosted checkout creation | Passed | Credential-gated suite created a real `cs_` Test Mode checkout without logging its URL, credentials, or customer data. |
| Signed paid webhook | Passed | Real `payment.paid` and `checkout_session.payment.paid` events settled PayMongo orders through `/api/webhooks/payments`. |
| Transactional paid effects | Passed | Paid order, final invoice, payment, license/subscription entitlement, and deduplicated commerce email records exist in certification PostgreSQL. |
| Provider payment retrieval | Passed | Credential-gated provider retrieval normalized a real `pay_` resource in Test Mode. |
| Persisted reconciliation | Passed | The real paid order reconciled with `matched: true` and no differences; certification also retains matched reconciliation records. |
| Full refund request | Passed | PayMongo accepted a Test Mode full refund and returned a real `ref_` resource. |
| Signed refund webhook | Passed | A genuine `payment.refunded` event was signature-verified and processed once. |
| Transactional refund effects | Passed | Order/payment became `REFUNDED`, invoice became `VOID`, licenses were revoked, subscription access was cancelled, and the refund email was deduplicated. |
| Live-mode isolation | Passed | Certification uses Test Mode and rejects unsafe live/test key-mode combinations. |
| Duplicate paid redelivery | Passed | Dashboard retry returned HTTP 200; the provider event remained one row and payment, invoice, license, email, and audit counts were unchanged. |
| Duplicate refund redelivery | Passed | Dashboard retry returned HTTP 200; refunded/void/revoked state and refund email/audit counts remained unchanged. |

No raw provider payload, Authorization value, API key, webhook secret, full license key, or billing record is retained as certification evidence. Webhook storage contains normalized fields and a SHA-256 payload hash. Caddy now removes `Paymongo-Signature` from access logs in both certification and production configuration.

## Deterministic integration evidence

The ordinary automated suite verifies:

- repeated identical paid and refund events produce no duplicate payment, invoice, license, subscription, or email effects;
- conflicting reuse of an event ID is rejected and recorded;
- overlapping paid event variants issue one entitlement;
- old event occurrence time with a fresh delivery signature is accepted, while stale delivery signatures are rejected;
- failed payments create no license and can be retried safely;
- refund processing revokes access exactly once;
- refund requests are locally idempotent before calling PayMongo again;
- cancelled orders can settle from a later authoritative paid event;
- amount, currency, reference, checkout, payment, and mode mismatches fail closed;
- reconciliation compares provider/local identifiers, amount, currency, mode, and status without auto-settling discrepancies.

## Provider-interactive cases still open

| Scenario | Status | Required evidence |
| --- | --- | --- |
| Genuine failed payment | Blocked on hosted PayMongo interaction | Complete a new local order using PayMongo's documented Test Mode failed-card path; retain only normalized event/result evidence. |
| Genuine delayed delivery | Blocked on Dashboard resend/time | Resend an older event. PayMongo must provide a fresh signature timestamp while the immutable event occurrence time remains old. |
| Genuine out-of-order delivery | Blocked on Dashboard resend | After refund, resend an older paid delivery and verify refunded state and revoked access remain unchanged. |
| Raw webhook fixture test | Intentionally skipped without restricted evidence files | Supply exact temporary raw bytes and signature outside the repository; delete them after the test. Runtime acceptance already proves genuine signature verification, but the raw fixture is not retained. |

PayMongo's second refund API request returned a provider validation error because the payment had already been fully refunded. Application-level refund initiation remains protected by a persisted local idempotency key, which deterministic integration tests verify.

## Verification executed during this continuation

- Credential-gated PayMongo suite: 2 passed, 4 skipped before evidence IDs were supplied.
- Genuine provider retrieval: passed.
- Genuine persisted reconciliation: passed after mapping the certification database to its host-only port.
- Evidence-enabled sandbox suite: 4 passed, 2 raw-webhook-file cases skipped.
- Genuine full Test Mode refund request: accepted; genuine signed refund webhook returned HTTP 200 and processed successfully.
- Production and certification Caddy configuration validation: passed.
- Runtime Caddy redaction probe: HTTP 400 as expected for a forged signature; the signature header was absent from access logs.

One initial reconciliation run failed because `.env.certification` names the Compose hostname `postgres`, which is unavailable to a host-side test process. The identical test passed using the documented loopback certification database port. This was an execution-address mismatch, not a reconciliation failure.

## Remaining owner actions

1. Complete one PayMongo Test Mode failed-card checkout created by this application.
2. Repeat one resend after sufficient delay and resend an older paid event after refund to preserve delayed and out-of-order provider evidence.
3. Confirm side-effect counts remain unchanged and no signature/raw payload appears in logs.
4. Optionally provide exact raw event/signature files in a restricted temporary directory for the two raw-fixture tests, then securely delete them.

Until those provider-interactive cases pass, the honest Phase 6.2 repository verdict remains **partially certified**. PayMongo LIVE operation is owner-confirmed, but full certification remains open.
