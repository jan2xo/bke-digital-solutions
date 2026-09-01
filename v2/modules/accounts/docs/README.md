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
- `bke.accounts.organization-profile-update.v1` — updates organization/profile/billing fields with the V1 split authorization rules: organization identity fields require MANAGE_MEMBERS, billing fields require VIEW_PAYMENTS, and mixed updates require both. Closed/closure-requested/suspended organizations are rejected.
- `bke.accounts.invitation-issuance.v1` — authorizes MANAGE_MEMBERS, enforces V1 mutable-organization lifecycle rules, lowercases the invite email, generates a 32-byte base64url token with SHA-256-only persistence, defaults expiry to seven days, and returns the raw token once to the trusted host boundary. V1 allows multiple PENDING invitations for the same account/email; issuance does not replace them.
- `bke.accounts.invitation-resend.v1` — resolves the invitation before authorization, reuses MANAGE_MEMBERS and mutable-organization policy, requires PENDING state, rotates only tokenHash + expiresAt, returns the new raw token once, and preserves invitation account/email/role/status. The PostgreSQL adapter also requires PENDING in the final UPDATE so a concurrent revoke/accept cannot be overwritten.

The generic account-access capability deliberately does not impose lifecycle mutability rules. V1 account access and role authorization were separate from organization lifecycle checks; organization mutations add those lifecycle invariants on top of the shared access primitive.

The account role/capability policy is Accounts-owned. Commerce and Licensing consume Accounts authorization results rather than duplicating the matrix.

HTTP, same-origin checks, Identity creation, Legal acceptance, email delivery, sessions, audit transport, Commerce, and Licensing remain outside Accounts. Invitation expiry/revoke/accept are separate Accounts capabilities and are not hidden inside issuance/resend.

This staging module must remain mechanically extractable to a future `@bke/accounts` package with `contracts/`, `logic/`, `providers/`, `prisma/`, `migrations/`, `tests/`, `module.manifest.ts`, and `docs/` ownership.
