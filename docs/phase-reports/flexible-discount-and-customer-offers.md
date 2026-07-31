# Flexible discount and customer-offer implementation report

## Implemented

- Exact basis-point discounts from 0–100%, separate from the annual 0–10% catalog rule.
- General, customer-account, and administrative offer types with product, edition, plan, account, date, and redemption scopes.
- PostgreSQL-serialized redemption reservations and immutable order, invoice, payment, and subscription pricing snapshots.
- Finite monthly promotional cycles, customer-authorized renewal orders, normal-price restoration, and renewal of the existing entitlement rather than duplicate subscription issuance.
- Explicitly authorized complimentary account orders with normal invoice, payment, licensing, audit, and email-outbox side effects.
- Administrator creation, enable/disable, usage, and unused-revocation controls plus checkout account/offer selection.
- Product-deletion blockers and permanent-customer-deletion ordering updated for the new restrictive relations.

## Verification executed

- `npx prisma validate`: passed.
- `npx prisma migrate dev`: migration `20260731025700_flexible_discount_offers` applied.
- `npx prisma generate`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Focused pricing, offer, product-deletion, and customer-deletion suites: 18 tests passed before the concurrency case was added.
- Complete `npm test`: 64 passed and 5 credential-gated tests skipped at that checkpoint.
- Updated offer suite with concurrent redemption: 5 tests passed.

## Final regression gate

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 68 passed; 5 credential-gated tests skipped (73 total).
- `npm run test:e2e`: 5 passed.
- `npm run build`: passed with 48 application pages generated.
- `npm run db:status`: all 8 migrations applied.
- `npm run db:smoke`: passed.
- `npm run security:hygiene`: passed for 239 tracked files.
- `npm audit --omit=dev --audit-level=critical`: 0 vulnerabilities.

Two stale Playwright assumptions were found and corrected: checkout now requires `customerAccountId`, and renewal extends the existing subscription license rather than creating a duplicate license owned by the renewal order. The first build attempt was blocked by sandbox port-binding restrictions and passed unchanged when rerun with the required local permission. The first browser launch failed because `playwright.config.ts` referenced a removed temporary npm installation; it now uses the installed `npm` executable.

The final invoice correction snapshots annual gross price, the 0–10% annual catalog discount, and the separate promotional offer name/code and amount as distinct invoice lines. The immutable line sum is tested against the payment total.

Credential-gated PayMongo and Resend tests remain skipped because real sandbox/delivery credentials were not present.

## Security decisions

- No stacking; one redemption per order is enforced by a unique database constraint.
- Private offers fail closed with the same not-found result as absent offers.
- Offer status and eligibility are reloaded after the row lock.
- Reserved, applied, and refunded redemptions consume limits; this prevents late verified payments from exceeding a limited promotion.
- PostgreSQL check constraints reject invalid rates, dates, counts, cycle states, and money identities.
- Historical offer identifiers in order/subscription snapshots are scalar values; offer-definition changes cannot rewrite history.

## Remaining external blockers

- PayMongo sandbox credentials and lifecycle certification.
- Resend verified sender/domain and real delivery certification.
- Production PostgreSQL, Valkey, object storage, backups, monitoring, malware scanning/code signing, legal, privacy, and tax approval.
