# Google-only authentication consumer acceptance

Starting canonical Digital Solutions main: a36d9decffa6936114a9578857558a9687ca4e7f. This independent authentication intent prepares the existing V3 application for the Workers compatibility proof in PR266; it does not deploy the application or replace its architecture.

## Required behavior

Use an independently certified immutable @bke/identity package from library PR85, reviewed at f703256274ed1f5f211bf7abeeb6e5cc46dffed5. Verify actual publication/source/bytes before adopting a release dependency; do not invent an available package URL. Preserve account IDs, customer/organization authorization, legal acceptance, application sessions, MFA, licensing and audit.

Digital Solutions offers Google OAuth/OIDC only. Retire password signup/login/reset/change and magic-link authentication fallback across browser and native-facing server entrypoints, with coherent UI/errors and no reachable native password-provider binding in the Worker application. Other consumers of the shared library may retain password capabilities.

Implement authorization code flow at /api/auth/google/callback. Production origin is https://jl-bke.com; exact redirect is https://jl-bke.com/api/auth/google/callback. Derive it from validated APP_URL, never arbitrary request headers. Use state, PKCE and nonce, verify signature, issuer, audience and expiry using an evaluated authoritative upstream library, and reject replay, wrong-browser context and unsafe return URLs. Keep login context short-lived and single-use using existing platform facilities where appropriate.

The expected public client audience is configured by GOOGLE_CLIENT_ID. Owner-supplied value: 762330940636-uuqstj4ig6ads84nid0bik35jkum4kt1.apps.googleusercontent.com. GOOGLE_CLIENT_SECRET belongs only in protected deployment configuration. Do not request secret JSON, retain Google refresh tokens merely for sign-in, log codes/tokens or introduce a second session authority.

Use validated stable Google subject as the external key. Never auto-link by matching email or promote from an email/domain. New authorized registrations default to CUSTOMER. Bind the subject atomically within the existing host registration/account/legal transaction, rolling back all records on collisions. Apply existing canonical BKE contact-email verification policy; Google profile claims must not silently mutate role, ownership or contact-verification state.

## Application-factor and administrator boundaries

Ordinary Google sign-in is BASIC; ordinary Google plus application MFA is MFA_VERIFIED without an automatic recent-auth timestamp. Sensitive actions use the owner-approved fresh BKE factor policy, bound to the exact validated active BKE user/session. Preserve expiry, attempts, consumption/replay, recovery, lifecycle, revocation and fail-closed dependency behavior.

Verified-contact unenrolled administrators may establish recent application-factor proof to enter/resume enrollment; this does not enable MFA or grant administrator privilege. Every other protected administrator operation must require enabled and verified MFA. Preserve Google methods when normal enrollment issues a replacement session; the current PASSWORD_EMAIL_OTP hardcode must not remain. Emergency enrollment retains its scoped owner authorization and Google provenance.

Inspect all relevant session producers/callers, including recovery and native browser handoff. An operator bootstrap must target an explicitly authorized bound BKE principal; no default password or automatic email-to-admin rule. Do not change native Agent/product repositories under this intent. Report incompatible native receiving behavior as a separate gate rather than silently retaining a password fallback.

## Verification

Use the existing intentional certification mechanism documented in .github/workflows/README.md. GitHub Actions is the default execution environment; no automatic duplicate push/PR pipeline is needed.

Required receiving proof includes legitimate returning/new Google users, invalid signature/issuer/audience/nonce/state, replay/expired context, unsafe redirects, binding/email collision, concurrent registration, failed transaction rollback, inactive/revoked/expired principals/sessions, login MFA/resend, fresh factor/administrator enrollment-resumption/recovery, logout, retired password surfaces, and preserved account/licensing contracts. Exercise actual request handlers and persistence where relevant, including error responses and side effects. Clearly identify mocks/controlled OAuth fixtures, real PostgreSQL, real browser/provider calls and workerd as different evidence.

Run relevant existing types/lint/tests, database migration replay, composition/security checks and the Node production build. Only necessary additive Google/session/challenge schema changes are allowed; no schema cleanup or history rewrite. Keep Docker source and existing domain behavior. Later Workers proof must verify the actual reachable bundle/runtime; a successful Node build does not prove Workers compatibility.

## Authority and completion

Implementation is pending when this contract is created. Primary agent owns orchestration/review; owner-selected GPT-6 Luna low effort owns coding. Preserve unrelated work and earlier scratch without wholesale adoption.

The owner explicitly authorized PR85 merge and Identity 0.5.0 publication. Library main/tag identity-v0.5.0 resolves to a8590377f913a5ce8802fca5cdaf562ad8d4ff7e, with tree 8346014c9e3cb7b31b760f41ede5bd7ffe7ea090 identical to the reviewed source. Publication run 41641996989 passed. The published bke-identity-0.5.0.tgz asset digest and certified build log agree on SHA-256 d78e365d2db23044fe1175114affb540823599380c5dda85042dfe8073e1a2b9. Adopt the actual immutable release and verify downloaded bytes in consumer certification. This does not authorize application merge/deployment, paid resources or provider changes.

No production deployment, provisioning, paid activation, live secrets, Google project changes, native repository edits or automatic application merge. Real Google client behavior, native interoperability, Workers resource/Free fit and production acceptance remain separate gates. Report source/CI/fixture acceptance honestly.
