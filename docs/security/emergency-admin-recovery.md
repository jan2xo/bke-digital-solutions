# Emergency administrator recovery

There is no password-based administrator path or public administrator creation route.

If an active Google-bound administrator loses every application MFA factor, an authorized operator must verify the target identity out of band, confirm BKE contact email verification, obtain the owner recovery secret, and use console access to run `npm run admin:recover-mfa` for the exact existing user ID. The CLI requires exact typed confirmation, a reason, an operator identity, and the protected-environment acknowledgement. It rejects users without a Google subject binding or a BKE-verified contact email.

The operation revokes existing emergency authorizations, MFA methods, recovery codes, challenges, and sessions; records an audit event; and creates a short-lived, one-time enrollment authorization. The operator must deliver the one-time token through the approved private operational channel and require fresh BKE-factor step-up and MFA enrollment. Never send it in tickets or chat, and never edit MFA rows manually.

To create a distinct administrator, follow the Google-only bootstrap steps in the [administrator runbook](../admin-mfa-runbook.md). It promotes an existing Google-bound active user after explicit authorization; it does not create users or change roles from Google email claims.
