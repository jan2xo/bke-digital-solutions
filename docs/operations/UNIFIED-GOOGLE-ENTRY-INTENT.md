# Unified Google Customer Entry (Issue #276)

This PR owns the **Identity/Legal** change on top of the already merged Sonnet storefront (PR #281). The historical stacked base was `0d82bf151bcbaa52d39fcd375dc3eb24ebf4bd69`; the branch is now reconciled against certified main `02ee043449f9835d94662aab6d0c455dd876ed18`. PR #275 is **not** part of this intent.

## Behavior

- One homepage **Continue with Google** button starts the server-owned OIDC flow immediately, not a two-step login/register choice.
- Returning subject: preserve the immutable binding and existing purchases, issue a validated session.
- Unknown verified subject: **no account yet**. Hand off verified identity via short-lived, purpose-bound encrypted HttpOnly cookie to mandatory Legal consent. Only after current published Terms+Privacy acceptance create one CUSTOMER account, bind the exact subject and issue session. Conflicts fail closed.
- Admin remains an existing bound role only. No provider email/domain auto-promotion.
- A separate /register UI is not part of the customer journey. Backward-compatible login URLs may redirect to single entry.

## Certification plan

Required exact-head: Identity, Legal, native-account boundary, Workers host/operation-scope where auth route behavior affected, core build/lint/runtime, browser UX new and existing, and adversarial replay, race, expiration, forged context, session-revocation and conflicting-email tests.

Not required: PayMongo/Commerce/entitlements/Agent/Launcher installers or any production/deployment workflows. Expand only if architecture/security ownership changes.

All certification intentional, through explicit dispatch. **Production LOCKED.**
## Legacy flow retirement

`/register` redirects to the one `/login` UI. The old public POST `flow: register` is intentionally rejected by strict start schemas and no longer accepted by signed OIDC context validation; it cannot provision before Google verification. `flow: login` remains accepted only as non-provisioning compatibility for an existing subject. `reauthenticate` preserves immutable user/session/subject binding. A new customer must accept current published Terms and Privacy after OIDC before transactional account creation.
