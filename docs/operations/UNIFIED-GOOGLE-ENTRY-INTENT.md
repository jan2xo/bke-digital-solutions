# Unified Google Customer Entry (Issue #276)

This PR owns the **Identity/Legal** change needed after PR #281's approved Sonnet storefront. It is based on the exact PR #281 head `0d82bf151bcbaa52d39fcd375dc3eb24ebf4bd69`. PR #275 is **not** part of this intent.

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