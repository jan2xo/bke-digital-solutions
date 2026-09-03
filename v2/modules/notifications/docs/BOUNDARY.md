# Notifications — V2 Ownership Boundary

Notifications owns transport-neutral notification intent. It does not own UI rendering, email, push, SMS, Telegram, Viber, account persistence, or campaign commerce rules.

## What I need

- source module/event identity;
- an audience selector;
- notification content;
- trigger/context metadata;
- an idempotency key;
- optional eligibility and expiry facts supplied by the caller.

Supported audience selectors:

- one principal;
- one account;
- one segment;
- all users;
- all active clients;
- a visitor, including first-visit/site-entry use cases.

## What I do

- validate and normalize a notification request;
- distinguish NOTIFY from DO_NOT_NOTIFY;
- preserve the semantic audience selector without resolving another module's database;
- carry an idempotency key for later durable dedupe/delivery implementations;
- remain independent of any presentation or transport technology.

## What I give

`bke.notifications.intent.v1`

The result is either:

- `NOTIFY` with a normalized transport-neutral notification intent;
- `DO_NOT_NOTIFY` for ineligible or expired requests;
- `FAILED` for invalid input.

## Explicit non-ownership

Notifications does not own:

- Accounts membership or user enumeration;
- Identity/session state;
- Commerce offer eligibility or pricing;
- browser/UI banners, modals, toasts, inbox rendering, or placement implementation;
- email, push, SMS, Telegram, Viber, webhook, or desktop delivery transports;
- durable inbox state, read/unread state, delivery receipts, or provider retries in this first capability;
- product-specific notification rules.

Audience resolution and delivery are later edge capabilities/adapters. A broadcast such as `ALL_USERS` is a semantic selector, not a direct query into Accounts persistence.

## Examples

- user login + eligible 50% Commerce offer -> PRINCIPAL + LOGIN -> notification intent;
- first visitor enters site -> VISITOR + FIRST_VISIT -> notification intent;
- admin announcement -> ALL_USERS + ADMIN_BROADCAST -> notification intent;
- maintenance for installed/active clients -> ALL_ACTIVE_CLIENTS -> notification intent.

## Stop conditions

- no UI wiring in this wave;
- no transport/provider implementation;
- no PostgreSQL merely for uniformity;
- no Accounts/Identity/Commerce Prisma reach-through;
- no frontend/V1 changes;
- no mandatory SBOM/provenance.
