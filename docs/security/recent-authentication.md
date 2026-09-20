# Recent authentication

High-risk operations require a server-side `recentAuthenticatedAt` timestamp no older than 15 minutes. Administrators request and confirm both their password and a purpose-bound email code, or use a single-use recovery code. Customers confirm their password before license-key disclosure. Browser state and UI visibility never satisfy this check.

`requireRecentAdmin` protects permanent deletion, customer maintenance and device resets, license administration, product-trial administration, offer mutations, release changes, artifact replacement/removal, audit export, MFA disablement, recovery-code regeneration, and password changes. Future role, session, and API-credential mutations must use the same boundary.

Clients receiving `RECENT_AUTH_REQUIRED` should send the user to `/security/recent?returnTo=<safe local path>`. Return paths are accepted only when they begin with one slash and not two.
