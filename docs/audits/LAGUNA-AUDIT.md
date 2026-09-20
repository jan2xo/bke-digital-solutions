# Laguna S 2.1 — Blind Read-Only Repository Audit

**Run:** Laguna Blind Audit
**Repository:** BKE Digital Solutions (`bke-digital-solutions`)
**Mode:** READ ONLY. No edits, no commits, no remediation.
**Branch:** `swarm/digital-solutions`
**HEAD:** `7696e8c docs: correct phase 6.9 checkpoint metadata`
**Working tree:** clean
**Evidence baseline:** direct source inspection of `app/`, `lib/`, `components/`, `tests/`, `prisma/`, `docker-compose*.yml`, `Caddyfile*`.

Findings below are grounded in concrete source. "Confidence: CONFIRMED" means the behavior was reproduced by tracing code from a request entry point to storage/authorization. Findings are NOT ordered by severity inside each section; priority ranking is at the end.

---

## 1. CONFIRMED CURRENT DEFECTS

### F-001 INFORMATION LEAK — invitation token hash returned in account detail
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** Only the invitation token (the bearer credential) must ever be known to the holder; the `tokenHash` is never part of any account representation, and pending-invitation views expose only `id, email, role, status, expiresAt, createdAt`.
- **Evidence:** `app/api/organizations/[id]/route.ts` line 10 performs `include: { organization: true, memberships: { ... }, invitations: canManageMembers ? { where: { status: "PENDING" }, orderBy: { createdAt: "desc" } } : false, ...`. With no `select`, Prisma returns all `Invitation` scalar fields, including `tokenHash` and `accountId`, into the JSON for every caller with `MANAGE_MEMBERS`. The dedicated list endpoint (`app/api/organizations/[id]/invitations/route.ts` line 10) correctly uses `select` to omit the hash; the account-detail path does not.
- **Impact:** Disclosure of a SHA-256 hash to every member-manager. Token is 32 random bytes, so offline brute-force is infeasible, but exposing hashes violates the "never expose tokens" principle and removes defense in depth; it also leaks `accountId` and timing metadata.
- **Existing coverage:** `tests/organization-boundary-routes.test.ts` only asserts the file imports `authorization`; it never asserts excluded fields. No test checks the serialized JSON body.
- **Reproduction:** `GET /api/organizations/{id}` logged in as OWNER; inspect JSON `invitations[].tokenHash`.
- **Remediation:** Replace the `invitations` include with an explicit `select` omitting `tokenHash` (and `accountId` if redundant).

### F-002 AUTHORIZATION — ownership transfer leaves prior owner with full authority
- **Severity:** HIGH
- **Confidence:** CONFIRMED
- **Invariant:** When ownership is transferred, the prior owner's effective role must no longer be `OWNER`, otherwise one of the core lifecycle guarantees (`assertLastOwnerPreserved`, the `OWNER`-only capability set) is silently violated.
- **Evidence:** `lib/organizations.ts` `transferOrganizationOwnership` (lines 146–157) updates `membership.role` for the *new* owner to `OWNER` and sets `customerAccount.ownerId` to the new owner, but never demotes the prior owner's `Membership.role` (which remains `OWNER`). `lib/authorization.ts` `requireAccountAccess` computes `effectiveRole` as `account.ownerId === userId ? "OWNER" : membership.role`. After transfer the prior owner is no longer `ownerId`, so their effective role is read from `Membership.role`, which is still `OWNER`. Net result: the former owner retains the full OWNER capability set while the account records a different owner.
- **Impact:** A transferred organization keeps its previous owner fully empowered: able to invite/remove members, change roles, suspend/close, and transfer ownership again. The "last-owner protection" and the documented capability matrix become ambiguous and bypassable by the original owner.
- **Existing coverage:** `tests/integration/organizations.test.ts` asserts `ownerId` changes and audit metadata; `tests/organization-private-db.test.ts` transfers ownership then removes a member and expects owner-exit to be blocked — but it never asserts that the *prior* owner lost capability. No test checks `requireAccountAccess(effectiveRole)` for the prior owner.
- **Reproduction:** Create org as user A (OWNER). Invite user B as MEMBER, promote to OWNER, transfer ownership to B. Authenticate as A and `GET /api/organizations/{id}` → role still `OWNER`; call `POST /api/organizations/{id}/lifecycle` with `action:"close"` as A → succeeds (should require the new owner, or at least not a demoted former owner).
- **Remediation:** In `transferOrganizationOwnership`, demote the actor's `Membership.role` away from `OWNER` (e.g., to `BILLING`) before/after setting the new owner, preserving the last-owner count semantics.

### F-003 CONTRACT — organization creation API bypasses email verification and legal clearance enforced elsewhere
- **Severity:** LOW–MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** State-changing customer workflows that establish a billing relationship (checkout, renewal, trial, download) require `user.emailVerified` and `assertLegalAcceptanceCurrent`; the customer-facing path to create an account that can be billed must enforce the same.
- **Evidence:** `app/api/organizations/route.ts` `POST` calls only `requireUser()` then `createOrganizationAccount`. Compare `app/api/trials/route.ts` (requires `emailVerified`), `app/api/orders/[id]/continue/route.ts` and `app/api/subscriptions/[id]/renew/route.ts` (require `emailVerified` + legal), `app/api/downloads/[artifactId]/route.ts` (require `emailVerified`). The organization-creation *page* (`app/dashboard/organizations/new/page.tsx`) does call `requireLegalClearance`, but the API itself does not, so any same-origin POST bypasses legal clearance; `emailVerified` is never checked on this route.
- **Impact:** An email-unverified (or pending-reacceptance) user can establish a billable organization account via the API, creating a customer-isolation/account-state surface inconsistent with the rest of commerce.
- **Existing coverage:** `tests/organization-boundary-routes.test.ts` only asserts source text contains `requireUser`; it does not assert `emailVerified` or legal guards.
- **Remediation:** Add `if (!user.emailVerified) throw new Error("FORBIDDEN")` and `await assertLegalAcceptanceCurrent(user.id)` to the creation `POST`.

---

## 2. SECURITY FINDINGS

### F-004 AUTH — customer license-key reveal does not require recent authentication
- **Severity:** MEDIUM (matches documented gap)
- **Confidence:** CONFIRMED
- **Invariant (core principle):** "Recent authentication lasts 15 minutes for protected operations." License-key reveal is a high-value secret read.
- **Evidence:** `app/api/licenses/[id]/reveal/route.ts` lines 2,5,11-12: imports `requireUser`, calls `requireUser()` — never `requireRecentUser`/`requireRecentSession`. TRUTHCHECK.md (lines 128–129) explicitly lists this as a known gap, so it is not newly discovered; it remains a real defect.
- **Impact:** A session stolen or a stale browser left open can reveal license keys indefinitely until the 60-minute idle/14-day absolute session expiry fires.
- **Existing coverage:** Browser acceptance (`tests/e2e/phase6-9-organization.spec.ts`) does not exercise license reveal.
- **Remediation:** Replace `requireUser` with `requireRecentUser` for reveal.

### F-005 SESSION — no customer self-service session inventory or revocation
- **Severity:** LOW
- **Confidence:** CONFIRMED
- **Invariant:** Customers should be able to view and revoke their own active sessions (equivalent to the admin `/admin/security` page).
- **Evidence:** No `app/api/account/...` or `app/dashboard/account/...` session management routes/pages exist; only admin security pages/routes (`app/api/admin/security/sessions/route.ts`, `app/admin/security/page.tsx`). The `User` model has no public session-listing surface. TRUTHCHECK (line 130) lists this as a known gap.
- **Impact:** Customers cannot detect/remove a compromised session; incident response ("revoke active sessions") is admin-only.
- **Remediation:** Add customer session listing + targeted revoke endpoints mirroring the admin surface.

### F-066 MFA / recent-auth — admin GET-only read of compliance/legal/etc. uses `requireAdmin` (no recent auth)
- **Severity:** INFO
- **Confidence:** CONFIRMED
- **Invariant:** Read-only admin views are acceptable with base admin auth; the repository consistently pairs `requireAdmin` for GET reads and `requireRecentAdmin` for mutations.
- **Evidence:** Spot check across `app/api/admin/*` confirms the pattern (e.g., `compliance`, `legal`, `support`, `supply-chain` GET = `requireAdmin`; mutations = `requireRecentAdmin`).
- **Value:** This is a strong boundary, reported as held-up in §9.

---

## 3. STATE / LIFECYCLE INCONSISTENCIES

### F-006 Lifecycle — closed/suspended organizations still reachable via account-detail GET
- **Severity:** LOW
- **Confidence:** CONFIRMED
- **Invariant:** A suspended/closed organization should be non-functional, but reading its profile (no commerce action) is acceptable; the defect is that `requireAccountAccess` in the account-detail GET does not enforce the `ACTIVE` lifecycle predicate used by commerce routes.
- **Evidence:** `app/api/organizations/[id]/route.ts` GET uses `requireAccountAccess` which does not exclude `CLOSED`/`SUSPENDED` accounts (it only checks member/owner relationship and capability). The same file's PATCH routes through `updateOrganizationProfile` → `requireMutableOrganization` which *does* reject closed/suspended. So a suspended org can still be *viewed* via the API while `assertAccountOperational` exists separately (`lib/customer-lifecycle.ts`).
- **Impact:** Information visibility into a legally-closed/suspended entity; not a commerce bypass.
- **Remediation:** Gate account-detail GET on lifecycle where appropriate, or document the read-as-view behavior.

### F-007 State divergence — `Membership.role = "OWNER"` vs `customerAccount.ownerId`
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** There should be one authoritative notion of ownership; the audit log metadata (`from`/`to` ownerId) and `assertLastOwnerPreserved` (counts `Membership.role="OWNER"`) create two parallel, divergence-prone authorities.
- **Evidence:** `inviteOrganizationMember` accepts `role: "OWNER"` (schema allows it), creating a non-`ownerId` member who is nonetheless `OWNER`-capable via `requireAccountAccess`. `transferOrganizationOwnership` mutates `ownerId` but leaves the `Membership.role` of the prior owner. `assertLastOwnerPreserved` keys off `Membership.role`, not `ownerId`.
- **Impact:** See F-002; the dual authority is the root inconsistency.
- **Remediation:** Canonicalize: either `Membership.role` is always derived from `ownerId`, or `ownerId` is derived from the OWNER membership.

---

## 4. CONCURRENCY / ATOMICITY / REPLAY FINDINGS

### F-008 REPLAY — invitation acceptance token not invalidated on replay; failure path returns the same ACCEPTED token body
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** A bearer invitation token must be single-use.
- **Evidence:** `lib/organizations.ts` `acceptOrganizationInvitation` uses a transactional `updateMany` on `tokenHash` status `PENDING → ACCEPTED` (line 118), which *is* single-use at the DB level. However, on a failed second attempt it falls through to `tx.invitation.findUnique({ where: { tokenHash: hashedToken } })` and throws `INVITATION_NOT_PENDING` while the *invitation object itself is not consumed*, and the API route (`app/api/organizations/invitations/accept/route.ts`) returns the *same token* to any caller — but note tokens are created server-side and emailed; the API does not return tokens to invitees. So the practical replay protection is DB-level and sound. The real, concrete issue is **F-001** (hash disclosure) and the lack of an explicit single-use marker on the token itself.
- **Impact:** None beyond F-001; documented to clarify that replay is controlled.
- **Note:** This finding is downgraded from speculative to CONFIRMED that the DB `updateMany` CAS provides single-use semantics. `tests/integration/organizations.test.ts` and `tests/organization-private-db.test.ts` verify duplicate acceptance is rejected and exactly one membership is created.
- **Remediation / no-op:** No code change required for replay; the token is consumed. Recommend adding an `acceptedAt` audit field for defense in depth.

### F-009 ATOMICITY — organization creation transaction does not lock against concurrent duplicate display/email
- **Severity:** LOW
- **Confidence:** CONFIRMED
- **Invariant:** None asserted; `displayName`/`billingEmail` uniqueness is not a documented constraint.
- **Evidence:** `createOrganizationAccount` uses a transaction but only `tx.customerAccount.create` (no `FOR UPDATE` / uniqueness on display name/email). Two concurrent creations by the same owner succeed as two distinct accounts.
- **Impact:** Minor; not a correctness/security defect unless uniqueness is a stated control (it is not).
- **Remediation:** None unless a uniqueness policy is introduced.

---

## 5. UI / API CONTRACT DEFECTS

### F-010 Contract — organization API error codes partially mapped, generic fallthrough to 400
- **Severity:** LOW
- **Confidence:** CONFIRMED
- **Invariant:** Known domain errors map to precise HTTP statuses; unknown errors map to 400 (acceptable for malformed input) but genuine server faults should not masquerade as 400.
- **Evidence:** `lib/http.ts` `apiError` returns `statuses[code] ?? 400` and body `{ error: status >= 500 ? "INTERNAL_ERROR" : code }`. Organization error codes added (`ACCOUNT_NOT_ORGANIZATION:400`, `INVITATION_NOT_FOUND:404`, `INVITATION_NOT_PENDING:409`, `INVITATION_EXPIRED:410`, `INVITATION_EMAIL_MISMATCH:403`, `OWNER_CANNOT_LEAVE:409`, `CLOSED_ACCOUNT:409`, `SUSPENDED_ACCOUNT:409`, `MEMBER_NOT_FOUND:404`, plus pre-existing `LAST_OWNER_REQUIRED:409`) are mapped. Any *other* thrown error (e.g., a Prisma runtime fault) becomes `400`.
- **Impact:** A DB error during invite creation returns `400 INVITATION_*`? No — it returns `400 INTERNAL_ERROR`-style? No: `apiError` returns code message when status<500. A Prisma `P2025` has message `...`; status would be 400 with the raw message leaked in the body. This is minor info disclosure of internal error text — but TRUTHCHECK doesn't claim otherwise.
- **Remediation:** Map generic DB faults to 500 and avoid echoing raw error strings on 4xx; out of scope for Phase 6.9 boundary and not touched.
- **Remediation constraint:** Do not weaken security to satisfy tests.

---

## 6. TEST AND ACCEPTANCE GAPS

### F-011 Static-only assertions in boundary route tests
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** Tests for new authenticated routes should exercise the route handler contract (auth rejection, same-origin rejection, capability gating), not just the file's import text.
- **Evidence:** `tests/organization-boundary-routes.test.ts` uses `readFileSync` and asserts string membership (`toContain("requireUser")`, `not.toContain("support")`, etc.). It never invokes the handlers.
- **Impact:** The 7 new `app/api/organizations/**/route.ts` files have zero unit/runtime coverage from this suite; they are only touched by the private-DB suite (which calls `lib/organizations` functions, not the HTTP routes) and the browser test (which does not POST to the new organization APIs).
- **Existing coverage:** None for the HTTP boundary of the new routes.
- **Remediation:** Add handler-level tests (auth required, same-origin required, capability gating per role).

### F-012 No API-level test for organization creation, owner transfer, or invitation management
- **Severity:** MEDIUM
- **Confidence:** CONFIRMED
- **Invariant:** Each new HTTP `POST`/`PATCH`/`DELETE` boundary should have at least one passing acceptance assertion.
- **Evidence:** `tests/organization-private-db.test.ts` exercises the *service layer* (`lib/organizations`) but not the HTTP routes. `tests/e2e/phase6-9-organization.spec.ts` exercises the UI account view and `GET /api/organizations` only; it creates the org via direct DB write (`db.customerAccount.create`), not via `POST /api/organizations`.
- **Remediation:** Add HTTP-level acceptance tests for the new organization APIs.

### F-013 Browser acceptance coverage does not match its name for organization *administration*
- **Severity:** LOW
- **Confidence:** CONFIRMED
- **Invariant:** A test named "organization membership is visible in the browser and isolated across accounts" should cover invitation management, role change, owner transfer, and leave — not only visibility.
- **Evidence:** The spec logs in as owner/member/limited/outsider and checks dashboard/account visibility and cross-account denial. It never invokes the new invitation, role-change, owner-transfer, or leave APIs through the browser.
- **Remediation:** Extend the browser spec to cover the administrative workflows added in Phase 6.9.

---

## 7. DOCUMENTATION / TRUTH DRIFT

### F-014 TRUTHCHECK stale "known authorization concern" for MEMBER visibility
- **Severity:** INFO
- **Confidence:** CONFIRMED
- **Invariant:** Documentation must not overstate gaps that the implementation already closes.
- **Evidence:** TRUTHCHECK.md lines 108–110 state "A plain MEMBER can currently open the account detail and see broad order, invoice, license, subscription, trial, and download information." The actual `app/dashboard/accounts/[id]/page.tsx` gates panels on `canViewOrders`/`canViewSubscriptions`/`canViewLicenses` and the browser test `tests/e2e/phase6-9-organization.spec.ts` now asserts "Order history" and "Subscriptions" are **not** visible for MEMBER. The trial/license lists are capability-gated (`canViewLicenses`) and licenses are assignment-filtered. The concern is materially addressed; TRUTHCHECK's wording is stale.
- **Remediation:** Update TRUTHCHECK "known authorization concern" to reflect the now-gated visibility and list only the residual gaps (license reveal recent-auth, customer session inventory).
- **Note:** Per instructions, do not treat TRUTHCHECK as authoritative over source; this is a doc-drift finding only.

---

## 8. EXTERNAL / RUNTIME EVIDENCE REQUIRED

These are **not** repo defects; they are gates that only the owner/VPS/prod-environment can satisfy:

- PayMongo **LIVE** webhook/checkout/end-to-end certification against the production gateway.
- Resend **verified-domain** production email delivery evidence.
- Production VPS cold-boot / RPO-RTO restore drill.
- Production malware-scanning certification (CLAMAV provisioning gate).
- Deployment of an explicitly approved commit (`5156caa` per ROADMAP) with deployed-commit evidence.
- Professional legal/DPO/accountant/BIR review of seeded legal text and commercial invoicing.

The local/certification browser run of `phase6-9-organization.spec.ts` **passes** in the Docker certification runtime (observed `1 passed in 17.2s` with live PostgreSQL/Valkey/MinIO services).

---

## 9. VERIFIED STRONG BOUNDARIES / THINGS THAT HELD UP UNDER AUDIT

- **Auth model:** `requireAdmin`/`requireAdminEnrollmentSession`/`requireRecentAdmin`/`requireRecentSession` are consistently applied; admin MFA requires password + purpose-bound email code or single-use recovery code; recovery codes are one-time; challenge attempt count capped at 5.
- **Authorization matrix:** `lib/authorization.ts` `matrix` matches the documented role matrix (`docs/authorization/customer-account-role-matrix.md`); `assertLastOwnerPreserved` protects the final owner; `requireAccountAccess` scopes reads by account ownership/membership.
- **Session security:** Argon2id; `__Host-bke_session` cookie in production (HTTP-only, Secure, SameSite=Lax, path `/`); 14-day absolute + 60-minute idle; password change revokes all sessions and re-issues.
- **Same-origin CSRF:** `assertSameOrigin` on every state-changing customer route; licensing/webhook/cron routes are token/licensing-based and correctly exempt.
- **Webhook integrity:** signature verification, idempotency via `webhookEvent` uniqueness + `skipDuplicates`, replay-conflict detection on payload-hash mismatch, `FOR UPDATE` ordering of order rows, `PROCESSED`/`FAILED` reattempt semantics.
- **Transaction isolation:** order cancel, order continue, checkout, close/cancel/suspend, privacy deletion, and final purge all run in `Serializable` transactions with row locks.
- **Privacy vs commerce:** `closeCustomer`/`pseudonymizeCustomer`/`executeFinalPurge` preserve orders/licenses/audit/acceptances; `customerRetentionBlockers` enumerates immutable-history blockers; legal holds block purge/pseudonymization.
- **Cross-account isolation:** order/cancel/continue/reveal/devices/trials all scope queries by `accountId` + membership with explicit role sets (`["OWNER","BILLING"]` for finance, `["OWNER","LICENSE_MANAGER"]` for licensing).
- **Rate limiting:** applied to login, MFA challenge, registration, password reset, support creation/reply, trials, downloads, webhooks, and admin provider/refund operations.
- **Error contract:** `lib/http.ts` maps the documented domain codes (and the organization codes added in this boundary) to precise statuses; `apiError` never leaks stack traces.
- **Secrets/env:** `lib/config/environment.ts` enforces `placeholder` detection avoidance, `secret` min-length 32, HTTPS-for-staging/production, S3 keys paired, Redis key prefix must contain `DEPLOYMENT_ID`, paymongo live-with-test-key rejection, in-memory rate limiter refused in production.
- **Organization boundary (this run's work):** `app/api/organizations/**` and dashboard pages are authenticated (`requireUser`), same-origin guarded, capability-gated, and audit-backed through existing `lib/organizations` transactional operations; `assertLastOwnerPreserved` and lifecycle rejection (`CLOSED`/`SUSPENDED`) are enforced.

---

## PRIORITY RANKING (remediation order)

1. **F-002** (HIGH) ownership-transfer retains prior owner authority — undermines the owner-transfer/lifecycle feature.
2. **F-001** (MEDIUM) tokenHash disclosure in account detail — information leakage.
3. **F-011 / F-012** (MEDIUM) new organization HTTP routes lack handler/acceptance tests.
4. **F-004** (MEDIUM) customer license reveal lacks recent auth — documented, still real.
5. **F-007** (MEDIUM) dual authority of ownership (root of F-002).
6. **F-003** (LOW–MEDIUM) organization creation bypasses emailVerified/legal clearance.
7. **F-013** (LOW) browser spec scope too narrow for "organization" name.
8. **F-005** (LOW) no customer session inventory.
9. **F-006** (LOW) closed/suspended org still viewable via account detail.
10. **F-008 / F-009** (LOW) replay-atomicity notes (mostly no-op).
11. **F-010** (LOW) generic error fallthrough (do not weaken to "fix").
12. **F-014** (INFO) TRUTHCHECK doc drift.

## OVERALL ASSESSMENT

The repository demonstrates strong foundational security (auth, MFA, authorization matrix, session handling, transaction isolation, webhook integrity, privacy preservation) and the Phase 6.9 organization-management boundary is correctly authenticated and capability-gated. However, three concrete, repo-controlled defects (F-002 owner-retention, F-001 tokenHash disclosure, F-003 creation contract gap) and incomplete test coverage of the new routes (F-011/F-012) represent real remediation work that is independent of the external VPS/provider gates. External certification (PayMongo/Resend/live deployment/cold-reboot/legal) remains an owner action and is required before any production claim.
