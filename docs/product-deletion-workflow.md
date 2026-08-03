# Product deletion workflow

Only archived products with no cart, commerce, invoice, payment, subscription, trial, offer, license, assignment, activation, grant, download, or license-event dependency qualify.

1. A recent administrator confirms the exact product name.
2. A serializable transaction locks/rechecks the product, marks deletion requested/inactive, and creates one durable job per image/artifact.
3. After commit, workers delete private objects idempotently.
4. Failures remain visible and retryable; database catalog rows still exist in pending state.
5. A separate serializable transaction requires every job `SUCCEEDED`, rechecks dependencies, deletes exclusive catalog children/product, and preserves audit/job tombstones through nullable product references.

Artifact replacement uploads/verifies the new object, switches the database reference and queues the old object in one transaction. Artifact removal marks it inactive/removed before queueing cleanup. Failure cannot silently remove the active installer reference.
