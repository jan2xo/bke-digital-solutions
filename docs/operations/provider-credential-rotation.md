# Provider credential rotation

1. Keep `PROVIDER_CONFIG_SOURCE=environment` while preparing migration.
2. Rotate the PayMongo test secret/webhook secret and Resend API key at each provider; do not reuse the values currently exposed during certification.
3. Configure a strong external `PROVIDER_CREDENTIALS_ENCRYPTION_KEY` and key version, restart, sign in as an MFA-enabled administrator, and complete recent authentication.
4. Open `/admin/providers`, save the new PayMongo TEST credentials and Resend credential/sender identity, then validate each configuration.
5. Enable each configuration. Change `PROVIDER_CONFIG_SOURCE=database` while leaving fallback false, then restart.
6. Execute sandbox checkout/webhook and Resend delivery certification. Confirm status and audit events; confirm logs contain no secret fragments.
7. Revoke the old environment/provider credentials and remove them from environment configuration.

Emergency response: disable the affected configuration, revoke its credentials at the provider, preserve audit evidence, issue replacements, validate, enable, and reconcile affected payments or mail. Database changes are forward-fixed; do not roll back commerce migrations or rewrite orders, payments, invoices, or licenses.
