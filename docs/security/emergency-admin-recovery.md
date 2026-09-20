# Emergency administrator recovery

There is no email-only MFA bypass and no public administrator creation route.

If administrator email delivery is unavailable, use one unused recovery code. If every factor is unavailable, an authorized operator must verify the administrator's identity out of band, obtain console access, back up the database, and run the CLI bootstrap for the exact existing account with `ADMIN_UPDATE_EXISTING=true` and `ADMIN_RESET_MFA=true`. Protected environments also require the documented bootstrap acknowledgement. Review the resulting security and audit events and require immediate email-code re-enrollment.

Creating a distinct administrator when one already exists requires the separate `ADMIN_ALLOW_ADDITIONAL=true` acknowledgement. Never delete MFA rows manually, print credentials, add an email bypass, or share recovery codes in tickets or chat.
