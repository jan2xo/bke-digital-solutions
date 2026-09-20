# Laguna S 2.1 — Normalized Findings

**Source:** independent normalization from `docs/audits/LAGUNA-AUDIT.md` + source re-verification.
**Status field:** one of `OPEN`, `FIXED`, `EXTERNAL/OWNER ACTION REQUIRED`, `NOT-ACTIONABLE`.

Findings are listed with the fields required by the run: ID, severity, confidence, invariant, evidence, reproduction, affected files, existing coverage, expected behavior, remediation constraints, status.

---

## F-001 — Information leak: invitation `tokenHash` returned by account detail
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** The invitation bearer token and its hash are never serialized into an account representation; pending-invitation views expose only `id, email, role, status, expiresAt, createdAt`.
- **Evidence:** `app/api/organizations/[id]/route.ts` line 10 `include: { invitations: canManageMembers ? { where: { status: "PENDING" } } : false }` returns all scalar fields including `tokenHash` and `accountId`. The dedicated list route (`app/api/organizations/[id]/invitations/route.ts` line 10) correctly omits the hash via `select`.
- **Reproduction:** Authenticated as OWNER; `GET /api/organizations/{id}`; observe `invitations[].tokenHash` populated.
- **Affected files:** `app/api/organizations/[id]/route.ts`
- **Existing coverage:** `tests/organization-boundary-routes.test.ts` (string-only; does not assert omitted fields). None assert serialized body.
- **Expected behavior:** Account-detail response omits `tokenHash` (and redundant `accountId`).
- **Remediation constraints:** Repository-controlled; no production/data impact. Minimum coherent fix: add `select` omitting `tokenHash`.
- **Status:** FIXED (Luna-reviewed and verified)

## F-002 — Authorization: ownership transfer leaves prior owner as full OWNER
- **Severity:** HIGH
- **Confidence:** CONFIRMED
- **Invariant:** After a successful ownership transfer, the prior owner's effective role must no longer be `OWNER`, so they cannot mutate the organization or re-transfer it.
- **Evidence:** `lib/organizations.ts` `transferOrganizationOwnership` (lines 146–157) sets `membership.role = "OWNER"` for the new owner and updates `customerAccount.ownerId`, but does not demote the actor's (prior owner's) `Membership.role`, which remains `"OWNER"`. `lib/authorization.ts` `requireAccountAccess` computes `effectiveRole` from `Membership.role` when the user is not `ownerId`.
- **Reproduction:** Create org as A; invite B, promote B to OWNER, transfer ownership to B; as A call `POST /api/organizations/{id}/lifecycle` with `{"action":"close"}` → succeeds.
- **Affected files:** `lib/organizations.ts`
- **Existing coverage:** `tests/integration/organizations.test.ts`, `tests/organization-private-db.test.ts` assert `ownerId` changed and audit metadata; none assert prior owner lost capability.
- **Expected behavior:** Prior owner's `Membership.role` is demoted to a non-OWNER role (e.g., `BILLING`) on transfer, preserving `assertLastOwnerPreserved` semantics.
- **Remediation constraints:** Repo-controlled; preserve last-owner protection (do not drop the final OWNER). Transactionally update.
- **Status:** FIXED (Luna-reviewed and verified)

## F-003 — Contract: organization creation bypasses email verification & legal clearance
- **Severity:** LOW–MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** State-changing customer workflows establishing a billable relationship require `user.emailVerified` and `assertLegalAcceptanceCurrent`, consistent with trials, checkout, renewal, download, and order-cancel.
- **Evidence:** `app/api/organizations/route.ts` `POST` uses only `requireUser()`. Compare `app/api/trials/route.ts` (`EMAIL_NOT_VERIFIED`), `app/api/orders/[id]/continue/route.ts` (`FORBIDDEN` + `assertLegalAcceptanceCurrent`), `app/api/subscriptions/[id]/renew/route.ts` (`FORBIDDEN` + legal), `app/api/downloads/[artifactId]/route.ts` (`FORBIDDEN`).
- **Reproduction:** Unverified user POSTs `POST /api/organizations` with valid body → 201 organization created.
- **Affected files:** `app/api/organizations/route.ts` (and `lib/legal/service.ts` `assertLegalAcceptanceCurrent`)
- **Existing coverage:** `tests/organization-boundary-routes.test.ts` (string-only). None assert `emailVerified`/legal on creation.
- **Expected behavior:** Creation rejects unverified/pending-reacceptance users with `FORBIDDEN`.
- **Remediation constraints:** Repo-controlled; align with existing commerce guards.
- **Status:** FIXED (Luna-reviewed and verified)

## F-004 — Auth: customer license-key reveal lacks recent authentication
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** High-value secret reads require recent authentication (15-minute window).
- **Evidence:** `app/api/licenses/[id]/reveal/route.ts` calls `requireUser()` only; TRUTHCHECK.md lines 128–129 document this gap.
- **Reproduction:** Reveal a license key after session is older than 15 minutes (but within 60-min idle / 14-day absolute) → succeeds.
- **Affected files:** `app/api/licenses/[id]/reveal/route.ts`
- **Existing coverage:** None asserting recent-auth gating on reveal.
- **Expected behavior:** `requireRecentUser()` for reveal.
- **Remediation constraints:** Repo-controlled; do not weaken other auth. May require browser test fixture refresh if reveal timing exceeds 15 min (acceptance runs under that).
- **Status:** FIXED (Luna-reviewed and verified)

## F-011 — Test gap: new organization HTTP routes are not exercised as HTTP handlers
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** Every new authenticated route should have handler-level assertions for auth rejection, same-origin rejection, and capability gating.
- **Evidence:** `tests/organization-boundary-routes.test.ts` uses `readFileSync` and substring assertions only.
- **Affected files:** `tests/organization-boundary-routes.test.ts`; routes under `app/api/organizations/**`
- **Existing coverage:** Service-layer coverage in `tests/organization-private-db.test.ts`; no HTTP-boundary coverage.
- **Expected behavior:** Add handler-level tests for the organization routes.
- **Remediation constraints:** Repo-controlled.
- **Status:** FIXED (Luna-reviewed and verified)

## F-014 — Documentation drift: TRUTHCHECK member-visibility concern is stale
- **Severity:** INFO
- **Confidence:** CONFIRMED
- **Invariant:** Documentation must not overstate gaps the implementation already closes.
- **Evidence:** `app/dashboard/accounts/[id]/page.tsx` gates Order/Subscriptions/Trials panels on capabilities; `tests/e2e/phase6-9-organization.spec.ts` asserts "Order history"/"Subscriptions" not visible for MEMBER. TRUTHCHECK.md lines 108–110 still claim MEMBER sees broad data.
- **Affected files:** `TRUTHCHECK.md`
- **Existing coverage:** N/A.
- **Expected behavior:** Update the known-concerns block to reflect capability-gated visibility and residual gaps.
- **Remediation constraints:** Documentation-only.
- **Status:** FIXED (Luna-reviewed and verified)
