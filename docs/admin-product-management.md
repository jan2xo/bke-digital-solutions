# Admin product management

Sign in with an administrator account and open `/admin/products`. Create a draft product with its first edition. Each edition owns features, authorized-user and per-user device limits, update policy, and visibility. Enable any valid combination of perpetual, monthly, and annual plans. Annual requires monthly and accepts only a 0–10% discount; its displayed total and savings are derived and cannot be overridden. A draft is not shown publicly until **Publish** is selected.

Edition/plan changes use `POST /api/admin/products/:id/editions` and `PATCH /api/admin/editions/:id`. The server validates the combination, minor-unit amounts, limits, and annual derivation. Metadata edits do not rewrite commerce or entitlement history.

Open `/admin/trials` to grant a seven-day trial for a specific customer account and edition. Administrator grants are additional to the annual self-service allowance. Set 0–14 grace days at grant time, change the grace period later, or revoke access. Each action updates the linked license transactionally and writes an audit record.

The original seven-day end and the grace end are stored separately. Reducing grace updates the linked license expiration predictably; removing grace sets access back to the original trial end. Revocation immediately overrides both dates.

Use the release form inside the product card to upload `.exe`, `.msi`, `.dmg`, `.pkg`, `.zip`, `.deb`, or `.AppImage` files up to 250 MB. The server calculates SHA-256, stores the object in the configured private S3-compatible bucket, and records its size, type, operating system, architecture, semantic version, release notes, publish state, and latest-version state. No permanent public URL is created.

Product fields can be changed with `PATCH /api/admin/products/:id`; publish, unpublish, and archive use the same endpoint. Version status can be changed with `PATCH /api/admin/versions/:id`. Every mutation requires a verified administrator session, same-origin request, validated input, and an audit record. `/admin/records` provides operational tables for customers, orders, payments, invoices, subscriptions, licenses, activations, and downloads.

Before publishing, verify the checksum independently, malware-scan and sign the binary, confirm release notes, and test installation on every advertised platform.
