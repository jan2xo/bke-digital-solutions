# Legal Acceptance History

Each `LegalAcceptance` is immutable evidence that a user accepted or acknowledged one exact `LegalDocumentVersion` in a defined context.

Stored evidence includes user, optional customer account, document version, context, timestamp, IP address, bounded user agent, SHA-256 of the rendered content, and the exact template-variable snapshot. Contexts currently include `REGISTRATION`, `CHECKOUT`, `RENEWAL_CHECKOUT`, and `REACCEPTANCE`.

Registration accepts the current Terms and Privacy versions in the same transaction that creates the user and individual account. Checkout accepts the current EULA and Refund Policy, plus Subscription Terms for monthly/annual plans, in the same transaction that creates the order. Browser-supplied identifiers are compared with server-loaded current versions; stale, missing, duplicated, or plan-inappropriate selections fail closed.

PostgreSQL foreign keys retain the referenced user/account/version, triggers reject updates and deletes, and unique indexes make retries idempotent even when the optional account is null. Administrators may view counts and the 20 most recent entries per version, but no application route can alter history.

Acceptance evidence is operational evidence, not a legal opinion. Retention, privacy access, erasure, legal hold, and evidentiary sufficiency require Phase 6.7 approval. Do not bypass immutability triggers to make a customer deletion workflow succeed.
