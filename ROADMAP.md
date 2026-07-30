# BKE Digital Solutions roadmap

## Current phase

Phase 4.1 — Product Lifecycle Completion is complete and locally verified. Administrators can permanently delete only archived, disposable products after a server-side dependency check. Phase 5 has not started.

## Milestones

- [x] Secure commerce and licensing foundation
- [x] Customer portal and private delivery MVP
- [x] PayMongo and Resend provider abstractions
- [x] Platform administration centers and audited operations
- [x] Guarded permanent deletion of disposable archived products
- [ ] Real PayMongo sandbox lifecycle
- [ ] Verified Resend delivery domain
- [ ] Production infrastructure and operational readiness

## Completed in Phase 4

Product metadata/edit/archive/restore/publish, release lifecycle and rollback, artifact upload/replace/remove/download counts, customer suspension/reactivation/device reset, license lifecycle/transfer/one-time reveal, device inventory/deactivation, order search/filter/cancellation, invoice history/re-email, searchable/exportable audit timeline, and dashboard widgets/recent activity.

## Phase 4.1 acceptance criteria

- Permanent deletion is offered only for archived products and has no force-delete path.
- A reusable server-side eligibility evaluator blocks commerce, invoice, payment, cart, subscription, license, activation, assignment, download, and other preserved history.
- Exclusive unused versions, artifacts, prices, policies, image metadata, and tags are removed transactionally; private storage cleanup is explicit and retry-safe.
- Successful and blocked attempts are recorded without customer data, credentials, license keys, provider payloads, or private object keys.
- Typed-name confirmation, structured conflict details, API authorization/origin checks, focused integration/browser coverage, and the full Phase 4 regression gate pass.

Phase 4.1 is an additive completion of Phase 4 and is a prerequisite to, not part of, Phase 5 external-provider certification.

## Deferred and blockers

- Revenue is an explicitly labeled gross-order placeholder, not accounting recognition.
- Product-image serving on public pages is deferred; secure upload and metadata are present.
- Automated refund initiation remains provider-dependent; confirmed refund records continue through webhooks.
- PayMongo sandbox and Resend verified delivery are blocked by owner-supplied credentials/domain setup.
- Production database, Redis, storage, backups, monitoring, malware scanning, code signing, legal, privacy, and tax review remain incomplete.

## Next phase

Phase 5 — External provider certification and production operations. Estimated remaining work: 5–8 focused engineering days plus external merchant/domain/DNS approval time.
