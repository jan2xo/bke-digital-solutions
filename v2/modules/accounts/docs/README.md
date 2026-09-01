# Accounts V2 staging module

Accounts owns the customer-account aggregate for both `INDIVIDUAL` and `ORGANIZATION` account types.

Owned persistence:

- `CustomerAccount`
- `OrganizationProfile`
- `Membership`
- `Invitation`

Identity principal identifiers are opaque external IDs. Accounts does not define or foreign-key an Identity `User` table. Composition is responsible for proving that a principal exists before invoking capabilities whose contract requires an existing principal.

The first certified capability is `bke.accounts.individual-account-creation.v1`, extracted from the account portion of V1 registration. It creates one active `INDIVIDUAL` account using the supplied principal ID, normalized display name, and normalized billing email. It intentionally does not create a `Membership` row because V1 individual registration represented ownership through `CustomerAccount.ownerId` only.

HTTP, same-origin checks, Identity creation, Legal acceptance, email delivery, sessions, audit transport, Commerce, and Licensing remain outside Accounts.

This staging module must remain mechanically extractable to a future `@bke/accounts` package with `contracts/`, `logic/`, `providers/`, `prisma/`, `migrations/`, `tests/`, `module.manifest.ts`, and `docs/` ownership.
