# Environment variables

Environment values are server-only unless explicitly prefixed for browser use. Commit examples, never real values.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Canonical browser, email-link, and provider-redirect origin. Certification and production: `https://jl-bke.com`. |
| `INTERNAL_APP_URL` | Optional private Docker application origin, normally `http://app:3000`. |
| `PUBLIC_WEBHOOK_ORIGIN` | Public HTTPS origin used to register the test webhook; certification: `https://jl-bke.com`. |
| `LOCAL_PRODUCTION_SIMULATION` | Enables staging-only local safety exceptions such as private HTTP MinIO; never production. |
| `PAYMONGO_SECRET_KEY` / `PAYMONGO_WEBHOOK_SECRET` | Server-only test credentials during certification. |
| `PAYMONGO_LIVEMODE` | Must be `false` for local certification. |
| `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_SANDBOX_TO` | Server-only delivery settings; recipient is certification-only. |

The full template is `.env.certification.example`. `npm run certification:env` generates an ignored safe local file without provider credentials.

Provider and certification commands explicitly load `.env.certification`. Existing containers retain their creation-time environment; use `npm run certification:compose -- refresh` after any change. Ordinary development continues to read `.env` and must not call PayMongo or Resend unless explicitly reconfigured.
