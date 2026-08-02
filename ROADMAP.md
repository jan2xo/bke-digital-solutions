# BKE Digital Solutions roadmap

Current operational milestone: complete local Docker+Caddy production simulation and genuine PayMongo/Resend sandbox certification before VPS deployment.

## Current phase

Phase 5.0 and Phase 5.1 are committed. Phase 5.2 has verified public Cloudflare-to-local routing, genuine Resend API/registration/outbox delivery, and real PayMongo test checkout creation. Genuine PayMongo payment/webhook/refund/reconciliation evidence remains open.

## Milestones

- [x] Secure commerce and licensing foundation
- [x] Customer portal and private delivery MVP
- [x] PayMongo and Resend provider abstractions
- [x] Platform administration centers and audited operations
- [x] Guarded permanent deletion of disposable archived products
- [x] Product editions with reusable capability entitlements
- [x] Perpetual, monthly, and calculated annual purchase plans
- [x] Multi-plan administration, storefront, checkout, and licensing migration
- [x] Reproducible production image, isolated service topology, configuration validation, and operational health foundation
- [x] Flexible general and customer-specific offers with immutable pricing and finite monthly promotional cycles
- [ ] Complete PayMongo sandbox lifecycle (checkout creation passed; payment/webhook/refund/reconciliation remain)
- [x] Resend sending domain verified for `jl-bke.com`
- [x] Phase 5.2C encrypted provider credential store, centralized source policy, and protected administrator controls
- [ ] Production infrastructure and operational readiness

## Completed in Phase 4

Product metadata/edit/archive/restore/publish, release lifecycle and rollback, artifact upload/replace/remove/download counts, customer suspension/reactivation/device reset, license lifecycle/transfer/audited authenticated reveal, device inventory/deactivation, order search/filter/cancellation, invoice history/re-email, searchable/exportable audit timeline, and dashboard widgets/recent activity.

## Phase 4.1 acceptance criteria

- Permanent deletion is offered only for archived products and has no force-delete path.
- A reusable server-side eligibility evaluator blocks commerce, invoice, payment, cart, subscription, license, activation, assignment, download, and other preserved history.
- Exclusive unused versions, artifacts, prices, policies, image metadata, and tags are removed transactionally; private storage cleanup is explicit and retry-safe.
- Successful and blocked attempts are recorded without customer data, credentials, license keys, provider payloads, or private object keys.
- Typed-name confirmation, structured conflict details, API authorization/origin checks, focused integration/browser coverage, and the full Phase 4 regression gate pass.

Phase 4.1 is an additive completion of Phase 4 and is a prerequisite to, not part of, Phase 5 external-provider certification.

## Phase 4.2 acceptance criteria

- Product URLs remain stable while each product supports one or more editions and each edition supports any permitted purchase-plan combination.
- Edition records own features, user/device limits, and update policy; purchase plans own payment model, interval, price, renewal, and duration only.
- Annual price, savings, and effective monthly price are derived from the monthly price using a server-validated 0–10% discount; no annual total override exists.
- Checkout accepts only a purchase-plan identifier from the browser and reloads every commercial value from PostgreSQL.
- New order, invoice, subscription, and license state snapshots the selected edition and plan without rewriting historical records.
- Pending customers can reuse or safely replace hosted checkout sessions, cancel only pending orders, and remain protected from duplicate or delayed webhook issuance.
- Each authorized customer account can self-start one seven-day trial per product and UTC calendar year; administrator grants and 0–14 day grace periods are separate and audited.
- ADMIN/origin/audit, customer isolation, webhook verification, safe deletion, credential-gated provider behavior, and the complete regression gate remain intact.

## Deferred and blockers

- Revenue is an explicitly labeled gross-order placeholder, not accounting recognition.
- Product-image serving on public pages is deferred; secure upload and metadata are present.
- Automated refund initiation remains provider-dependent; confirmed refund records continue through webhooks.
- PayMongo test checkout creation passed. A real customer-authorized sandbox payment, genuine signed webhook replay/delay/failure/refund, and reconciliation remain open. Genuine Resend direct, registration, and outbox delivery passed.
- Production database, Redis, storage, backups, monitoring, malware scanning, code signing, legal, privacy, and tax review remain incomplete.
- Provider-aware expiry of abandoned offer reservations is deferred; reservations remain consumed until settlement can be ruled out safely.

## Next phase

Phase 5.1 — Administrator MFA and Recent Authentication. Phase 5.2 covers API credentials, service accounts, and rotation; Phase 5.3 covers expanded security operations and session administration; Phase 5.4 is the enterprise security review/certification gate. The later subphases are documented only and not implemented. External provider certification remains a separate launch gate.
