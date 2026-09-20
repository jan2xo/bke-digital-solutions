# Legal Document Versioning

## State model

```text
DRAFT -> PUBLISHED -> ARCHIVED
           ^             |
           +--- restore--+
```

A document owns monotonically increasing version numbers and at most one current published pointer. Creating or duplicating always produces a new draft. Draft source, summary, and reacceptance choice may change. Publication sets publication/effective timestamps and archives the previous current version. Restore makes an already published archived version current again without rewriting it.

## Immutability

Route handlers reject edits and deletes for non-drafts. PostgreSQL triggers independently reject content, hash, version number, document, publication time, or author changes after publication and reject physical deletion of published/archived versions. State transitions and archive timestamps remain mutable so archive and rollback work.

## Rendering and variables

Supported variables are `company_name`, `support_email`, `website`, and `business_address`. Unknown variables remain visible for review. Raw HTML is escaped, and the limited renderer supports headings, unordered lists, paragraphs, emphasis, inline code, and safe HTTP/HTTPS or relative links. `javascript:` and other unsafe links become inert.

## Reacceptance

When a published current version has reacceptance enabled, customers whose accounts predate its current publication or restore and lack acceptance for that exact version are redirected to `/legal/accept` on the next password/magic-link login and protected portal navigation. Their session remains valid. Protected customer APIs fail with a controlled conflict until acceptance, so direct requests cannot bypass the gate. Restoring an older version updates its state-transition timestamp and applies the same exact-version rule.
