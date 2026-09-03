# Notifications extraction boundary

Reusable package authority is intended to become `@bke/notifications`.

## Extractable
- `contracts/`
- `logic/`
- `module.manifest.ts`
- behavior tests

## Digital Solutions host-only
- `module.ts`
- host composition/adapters
- future UI and delivery transport wiring

## Forbidden in reusable Notifications
- Digital Solutions host contracts/platform/apps
- Next.js/UI code
- email/SMS/push/Telegram/Viber/Desktop transport implementations
- provider credentials
- cross-module Prisma or repository access
- Prisma/persistence merely for uniformity

Reusable Notifications owns the decision/intent primitive only. Delivery, rendering, and host-specific recipient resolution remain adapters outside the package core.
