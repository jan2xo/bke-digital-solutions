# Administrator provider settings

The provider page is at `/admin/providers`. Administrator MFA is mandatory; saving, validation, enablement, disablement, and revocation require authentication within the last 15 minutes.

PayMongo sandbox accepts a new test secret key and webhook signing secret. Resend accepts a new API key plus sender name, verified `@jl-bke.com` sender address, and support address. Secret fields intentionally render empty after save. Only masked hints appear after reload.

The safe sequence is save, validate, then enable. Replacement values revoke prior rows transactionally. Revoke disables the configuration immediately. PayMongo live controls are locked during certification and local production simulation.
