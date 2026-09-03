# Notifications — V2 Ownership Boundary

Notifications owns the decision to create a transport-neutral notification plan. It does not own UI rendering, email, push, SMS, Telegram, Viber, desktop delivery, or recipient-domain persistence.

## WHAT I NEED

- an audience selector;
- a trigger/context;
- notification content;
- optional first-visit/authentication/expiry rules;
- an optional dedupe key and caller-supplied prior-delivery fact.

Supported audience selectors in the foundation capability:

- one user;
- one account;
- one segment/group;
- all users;
- all active clients;
- a visitor, including anonymous first-visit contexts.

Supported trigger classes in the foundation capability:

- login;
- site entry;
- manual/broadcast;
- named domain/application event.

## WHAT I DO

`bke.notifications.decision.v1` validates the request, applies notification eligibility rules, suppresses expired/duplicate/ineligible notifications, and normalizes a transport-neutral notification plan.

The module currently has no persistence because durable notification inbox/delivery state is not yet required by a certified consumer. Dedupe/delivery history is supplied as a fact by the caller. Persistence must be added only when a real durable notification capability requires it.

## WHAT I GIVE

The capability returns exactly one of:

- `NOTIFY` with a normalized notification plan containing audience, trigger, content, dedupe key, and decision time;
- `DO_NOT_NOTIFY` with an explicit reason.

The output is intentionally transport-neutral. A later UI/email/push/desktop/etc. adapter may consume the plan without changing the source module that caused the notification.

## Examples

- user login -> eligible 50% promotion -> `NOTIFY` for one user;
- first site entry -> welcome campaign -> `NOTIFY` for visitor;
- admin broadcast -> `ALL_USERS` -> `NOTIFY`;
- active-client maintenance notice -> `ALL_ACTIVE_CLIENTS` -> `NOTIFY`;
- returning visitor against a first-visit-only campaign -> `DO_NOT_NOTIFY`;
- previously delivered dedupe key -> `DO_NOT_NOTIFY`.

## Explicit non-ownership

Notifications does **not** own:

- Identity authentication/session state;
- Accounts membership/customer ownership;
- Commerce offers/pricing eligibility;
- Payments settlement facts;
- Entitlements or Licensing rights;
- recipient address books;
- HTML/UI banners, dialogs, toasts, or inbox components;
- email/SMS/push/Telegram/Viber/Desktop transports;
- provider credentials;
- product-specific campaign logic.

Those domains may provide facts or consume the notification plan through contracts/adapters later.

## Stop conditions

- no UI wiring in the foundation wave;
- no transport/provider implementation;
- no invented persistence;
- no cross-module Prisma access or foreign keys;
- no V1 changes;
- no production database mutation;
- no mandatory SBOM/provenance gate.
