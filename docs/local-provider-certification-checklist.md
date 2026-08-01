# Local provider certification checklist

Never paste credentials, webhook signatures, raw payloads, email tokens, or customer personal data here. Use synthetic test identities only.

Evidence fields for each case: date/time; local order ID; redacted provider reference; observed event type; result; issue; screenshot/log reference; production blocker yes/no.

- [x] Start the production-like Docker stack; local and public health/readiness passed.
- [x] Start the named HTTPS tunnel; public application routing passed.
- [ ] Sign in as an MFA-enabled administrator.
- [ ] Verify a published product and perpetual, monthly, and annual plans.
- [x] Register an owner-controlled certification customer and deliver its verification email; owner verification click remains.
- [ ] Complete undiscounted perpetual checkout.
- [ ] Complete monthly and annual checkout.
- [ ] Confirm annual catalog discount plus promotion snapshot on order/invoice.
- [ ] Confirm customer-specific offer cannot be used by another account.
- [ ] Exercise an explicitly authorized zero-total checkout without contacting PayMongo.
- [ ] Confirm checkout/payment attempt records and immutable snapshots.
- [ ] Confirm success and cancel redirects use the configured canonical origin.
- [ ] Continue and cancel pending orders; confirm cross-account attempts fail.
- [ ] Complete a successful sandbox payment and observe the exact genuine event type.
- [ ] Confirm exactly one invoice, entitlement, subscription/license, and email-outbox set.
- [ ] Exercise failed payment and local cancellation.
- [ ] Exercise late provider payment after cancellation and record authoritative-provider behavior.
- [ ] Replay identical webhook bytes; confirm no duplicates.
- [ ] Reuse an event ID with changed signed bytes; confirm payload mismatch is rejected.
- [ ] Test fresh-signature delayed event, stale signature, malformed signature, and unsupported type.
- [ ] Test retry after a deliberately recoverable processing failure.
- [ ] Test refund and refund-before-payment if the sandbox account permits it.
- [ ] Run reconciliation and review pending/paid/cancelled/refunded/unmatched results.
- [ ] Confirm invoice, license, download, and activation ownership boundaries.
- [x] Run genuine Resend direct delivery and public registration verification delivery.
- [x] Process one genuine outbox message twice; it remained one `SENT` row with one attempt.
- [ ] Stop the tunnel and disable/delete the temporary webhook.
