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
- `bke.accounts.invitation-revocation.v1` — resolves the invitation before authorization, reuses MANAGE_MEMBERS and mutable-organization policy, requires PENDING state, and changes only the invitation status to REVOKED. The final PostgreSQL UPDATE also requires PENDING so concurrent accept/expire/revoke transitions cannot be overwritten.
- `bke.accounts.invitation-expiration.v1` — Accounts-owned lifecycle sweep with no actor authorization. It atomically transitions every PENDING invitation whose `expiresAt <= now` to EXPIRED, including invitations belonging to non-active accounts, and returns one host-owned audit intent per successfully expired invitation. Repeated execution at the same clock is idempotent.
- `bke.accounts.invitation-acceptance.v1` — hashes the raw token with SHA-256, lowercases the supplied principal email, and atomically claims exactly one matching PENDING invitation only while `expiresAt > now`. Failure classification preserves V1 ordering (`NOT_FOUND`, `NOT_PENDING`, `EXPIRED`, then email mismatch). After claim, Accounts rejects non-organization, closed/closure-requested, or suspended accounts; those rejections roll the claim back. Successful acceptance upserts the principal Membership to the invitation role and returns host-owned audit intent. Identity principal/email resolution remains composition-owned.
- `bke.accounts.membership-role-change.v1` — reuses MANAGE_MEMBERS authorization and mutable-organization lifecycle rules, updates only an existing Membership role, and preserves V1 last-owner semantics: an OWNER Membership cannot be changed to a non-OWNER role when the account has one or fewer OWNER Membership rows. The PostgreSQL adapter serializes role changes on the CustomerAccount row before counting owners, so concurrent OWNER demotions cannot both bypass the invariant. Missing targets return `MEMBER_NOT_FOUND`; audit transport remains host-owned.
- `bke.accounts.membership-removal.v1` — reuses MANAGE_MEMBERS authorization and mutable-organization lifecycle rules, removes only an existing Membership, and preserves V1 last-owner semantics by rejecting deletion of the final OWNER Membership. The PostgreSQL adapter locks the CustomerAccount before owner counting/deletion, so concurrent OWNER removals cannot delete all owners. Missing targets return `MEMBER_NOT_FOUND`; the removed Membership snapshot crosses the trusted result boundary and audit transport remains host-owned.

The generic account-access capability deliberately does not impose lifecycle mutability rules. V1 account access and role authorization were separate from organization lifecycle checks; organization mutations add those lifecycle invariants on top of the shared access primitive.

The account role/capability policy is Accounts-owned. Commerce and Licensing consume Accounts authorization results rather than duplicating the matrix.

HTTP, same-origin checks, Identity creation, Identity principal/email verification, Legal acceptance, email delivery, sessions, audit transport, scheduler orchestration, Commerce, and Licensing remain outside Accounts.

This staging module must remain mechanically extractable to a future `@bke/accounts` package with `contracts/`, `logic/`, `providers/`, `prisma/`, `migrations/`, `tests/`, `module.manifest.ts`, and `docs/` ownership.
