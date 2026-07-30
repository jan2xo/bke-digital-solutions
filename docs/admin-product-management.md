# Admin product management

Sign in with an administrator account and open `/admin/products`. Create a draft with a PHP price, billing type, seat limit, and device limit. A draft is not shown in the public catalog until **Publish** is selected.

Use the release form inside the product card to upload `.exe`, `.msi`, `.dmg`, `.pkg`, `.zip`, `.deb`, or `.AppImage` files up to 250 MB. The server calculates SHA-256, stores the object in the configured private S3-compatible bucket, and records its size, type, operating system, architecture, semantic version, release notes, publish state, and latest-version state. No permanent public URL is created.

Product fields can be changed with `PATCH /api/admin/products/:id`; publish, unpublish, and archive use the same endpoint. Version status can be changed with `PATCH /api/admin/versions/:id`. Every mutation requires a verified administrator session, same-origin request, validated input, and an audit record. `/admin/records` provides operational tables for customers, orders, payments, invoices, subscriptions, licenses, activations, and downloads.

Before publishing, verify the checksum independently, malware-scan and sign the binary, confirm release notes, and test installation on every advertised platform.
