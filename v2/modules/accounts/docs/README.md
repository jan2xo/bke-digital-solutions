# Accounts V2 staging module

Accounts owns the customer-account aggregate for both `INDIVIDUAL` and `ORGANIZATION` account types.

Owned persistence:

- `CustomerAccount`
- `OrganizationProfile`
- `Membership`
- `Invitation`

Identity principal identifiers are opaque external IDs. Accounts does not define or foreign-key an Identity `User` table. Composition is responsible for proving that a principal exists before invoking capabilities whose contract requires an existing principal.

Certified capabilities:

- `bke.accounts.individual-account-creation.v1` — creates the INDIVIDUAL account portion of registration. Ownership is represented by `ownerId`; no Membership row is created.
- `bke.accounts.account-access.v1` — resolves account access and the effective OWNER/BILLING/LICENSE_MANAGER/MEMBER role, then applies the V1 account capability matrix when a required capability is supplied.
- `bke.accounts.switchable-account-list.v1` — lists only ACTIVE accounts owned by or shared with a principal, preserving V1 `type ASC, createdAt ASC` ordering and owner-role precedence.
- `bke.accounts.organization-account-creation.v1` — atomically creates an ORGANIZATION CustomerAccount, OrganizationProfile, and OWNER Membership. Verified-email and Legal-acceptance prerequisites remain composition concerns. The capability returns audit intent rather than owning the application AuditLog table.

The generic account-access capability deliberately does not impose lifecycle mutability rules. V1 account access and role authorization were separate from organization lifecycle checks; later Accounts capabilities own those lifecycle-specific invariants.

The account role/capability policy is Accounts-owned. Commerce and Licensing consume Accounts authorization results rather than duplicating the matrix.

HTTP, same-origin checks, Identity creation, Legal acceptance, email delivery, sessions, audit transport, Commerce, and Licensing remain outside Accounts.

This staging module must remain mechanically extractable to a future `@bke/accounts` package with `contracts/`, `logic/`, `providers/`, `prisma/`, `migrations/`, `tests/`, `module.manifest.ts`, and `docs/` ownership.
