# Digital Solutions Google-only authentication

## Approved consumer policy

Google OAuth/OIDC is the sole customer and administrator sign-in provider. This policy supersedes the earlier Digital Solutions BKE MFA requirement. The owner confirmed this is fresh infrastructure and approved contact verification for Gmail and Google Workspace addresses only.

Customer flow: Google sign-in → secure BKE session → pending legal acceptance → dashboard. Registration records current legal versions transactionally with the customer, owned account and immutable Google subject. No password, magic link, email OTP, BKE MFA enrollment/challenge/recovery code, or separate BKE email-verification link is required or exposed.

Google authenticates the person. BKE remains authoritative for lifecycle, sessions, roles, account membership, purchasing, Claim Codes, entitlements, license activation, signing and administrative authorization. Google email addresses never select an existing principal or grant an administrator role.

## Trust and contact boundaries

The OIDC consumer retains authorization-code flow, PKCE S256, encrypted short-lived browser context, state, nonce, one-use Redis consumption, explicit ID-token signature verification and issuer/audience/expiration checks. No provider token or authorization code belongs in an application error, log, URL redirect or evidence artifact.

Bind by Google's immutable subject, never email. A matching email belonging to a different BKE user is a conflict, not account linking. A returning subject retains its BKE user ID, ownership and entitlements. Its Google-authoritative contact may update that same principal; uniqueness conflicts fail closed.

Contact is authoritative only when signed `email_verified=true` and the signed email is Gmail or a signed nonempty Workspace `hd` is present. Third-party Google account addresses without this authority are rejected; no fallback verification email creates an alternative sign-in or recovery path. See [Google backend verification guidance](https://developers.google.com/identity/sign-in/web/backend-auth).

## Sessions and sensitive operations

Only exact `GOOGLE_OIDC` browser sessions are admitted. Shared password and application-MFA session methods remain unsupported in this consumer. Existing shared-package session expiration, idle timeout, revocation and last-seen handling remain. Each admitted browser session also requires an active, non-suspended, Google-bound BKE principal.

Ordinary Google sessions are BASIC. Sensitive operations retain their existing recent-authentication guards. They require validated signed Google `auth_time` within 15 minutes, persisted for the exact BKE session with `mfaVerifiedAt=null`. Token `iat`, callback time, consent and account selection never substitute for authentication time and are never labeled MFA.

The consumer requests `claims={"id_token":{"auth_time":{"essential":true}}}`. Google documents that this claim must also be enabled in client settings. A reauthentication context binds the active BKE session ID, BKE user ID and existing Google subject. A switched account, different/revoked browser session, missing/stale/future/invalid proof cannot refresh the session. Reauthentication does not issue a new BKE session.

Google's documented prompt values do not guarantee forced primary reauthentication. If the configured client cannot return a recent signed authentication time, protected operations remain locked. This is a real availability limitation requiring provider acceptance, not a successful reauthentication claim. See [Google OIDC claims and request parameters](https://developers.google.com/identity/openid-connect/openid-connect).

## Administrator assignment and recovery

Operator bootstrap selects an existing active Google-bound, Google-contact-verified BKE user ID. It requires explicit operator identity and reason, refuses an additional administrator without the existing explicit switch, revokes browser and Agent session families, and audits the promotion. No email allowlist or OAuth domain grants administrator status.

Google owns ordinary Google account recovery. BKE offers no email-link, OTP, password, MFA recovery-code or automatic subject-rebinding recovery path. A lost Google account cannot take over an existing BKE principal merely by knowing its contact address. Exceptional ownership recovery requires a separate owner-approved operator procedure; support email alone is not authorization.

Removing BKE MFA means a compromised Google account or active Google session can authenticate to BKE. Sensitive freshness and BKE session revocation reduce some risks but do not replace an independently operated second factor. Google account security and recovery are now the identity-provider boundary. Neither token issuance nor this source review proves Google MFA occurred.

## Runtime and retained data

Authentication composes only the released Identity consumer capabilities. Database construction validates its database connection independently of unrelated provider configuration; full deployment validation remains an explicit CI/deployment operation. Sign-in does not initialize outbound email, payments or licensing providers.

Cloudflare is the approved primary business-email transport and Resend the fallback. Wiring/delivery acceptance of that business integration is separate. Neither is an authentication dependency.

The shared immutable `@bke/identity` 0.5.0 artifact remains unchanged for other applications. This consumer exposes only Google binding/authentication, principal lookup and session issue/validation/termination/administration. Historical migrations, generated schema and shared-package MFA tables are not silently deleted or rewritten. No live database cleanup is part of this source task.

Native sign-in uses the existing browser device-authorization flow. Bearer-token/account authorization remains in the native session helper; password/MFA consumers are removed. Existing protected native operations must not manufacture freshness from an Agent access-token issuance. Native gift-code reveal remains denied without its existing session-specific recent proof; no new bridge or native feature acceptance is claimed by this cleanup. Installed Launcher/Agent interaction requires separate native verification.

## Evidence checklist

- [ ] Exact resulting source head recorded in PR #267.
- [ ] Core lint, typecheck, application build, disposable PostgreSQL replay and runtime tests inspected.
- [ ] Google token/signature/issuer/audience/expiry/state/nonce/PKCE and replay fixtures pass.
- [ ] New/returning customer, immutable binding, concurrent registration, legal and contact policy tested.
- [ ] Ordinary administrator access, role rejection, protected-action freshness, revoked/suspended session and recovery boundaries tested.
- [ ] Existing purchase, Claim Code redemption, licensing, logout, revocation and native account authorization suites pass.
- [ ] Shared-package consumer, composition and host-boundary checks pass.
- [ ] Final integrated dependency/security gate passes with PR #269's reviewed dependency choices.
- [ ] Real configured Google sign-in and optional signed auth_time behavior observed.
- [ ] Installed Launcher/Agent handoff and sensitive native feature behavior observed.
- [ ] Production deployment verification separately authorized and completed.

CI fixtures and source checks do not establish real Google configuration, email delivery, installed native behavior or production acceptance. New source evidence supersedes the old MFA-policy acceptance only at its exact reviewed head. No merge, deployment or authentication cutover is authorized.

## Disposable browser fixtures

The retained business browser specs use `tests/e2e/google-session-helper.ts`. Run them only with explicit `BKE_E2E_DISPOSABLE_DB=1`, a loopback disposable PostgreSQL URL, a localhost app and non-production Node mode. The helper binds an existing fixture principal, issues a real BKE `GOOGLE_OIDC` session and writes synthetic recency for protected-operation scenarios. It never assigns roles or automates Google. These fixtures do not certify provider authentication, Google contact claims or actual Google authentication time. Real callback protocol and signed-claim behavior have separate tests/provider acceptance.
