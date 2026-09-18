# BKE Digital Solutions V3 — Account-First Licensing & Agent-Managed Launcher Plan

**Date:** 2026-09-19
**Status:** Architecture plan / pre-implementation
**Repository:** `jan2xo/bke-digital-solutions`

## 1. Owner decision

`develop/v2` is frozen for the next architecture wave.

Major new architecture work should proceed as a new V3 program rather than continuing to reshape the frozen V2 convergence branch.

V3 target:

```text
User Identity
    ↓
Customer Account
  ├─ Personal
  └─ Organization
        ↓
Entitlement
        ↓
Seat / Member Assignment
        ↓
Device / Installation
        ↓
Signed Lease
        ↓
Licensing Agent
        ↓
BKE Launcher / Product
```

V3 is **not started until the current Render Dock licensing recovery is certified on the real machine**.

---

## 2. Immediate execution priority before V3

Finish the current Render Dock 1.0.2 stale-authority recovery using the existing installed .NET Licensing Agent.

Execution order:

```text
1. Preserve current Licensing Agent installation/state
2. Install exact Render Dock 1.0.2 recovery candidate
3. Prove stale authority is detected
4. Prove Agent-owned License Center opens
5. CANCEL — do not activate yet
6. Prove Render Dock remains closed
7. Prove agent.db and Agent binaries remain untouched
8. Collect PASS evidence
9. Only after PASS: perform real 1.0.2 activation
10. Verify new signed 1.0.2 authority
11. Verify Render Dock launches
12. Close recovery milestone
13. Begin V3 implementation
```

### Current recovery candidates

**BKE SDK PR #13**
- Branch: `fix/licensing-authority-recovery`
- Exact head: `eb194d71f33e881fa34d50b3ba20743d51ad1b73`
- Package: `BKE.Desktop.Licensing 2.0.1`
- Adds `RecoveryRequired` and Agent-owned License Center recovery for stale signed authority.

**BKE Licensing Agent PR #39**
- Branch: `fix/dotnet-authority-recovery`
- Exact head: `267ab64ac2948e0722f0f40c9d8433588cca5c7a`
- Classifies `lease_version_rejected`, `lease_expired`, `lease_revoked`, `lease_superseded`, and `lease_authority_mismatch`.
- Remains DRAFT / UNMERGED.

**Render Dock PR #19**
- Branch: `fix/licensing-authority-recovery`
- Exact head: `e807981bbe7c4797112199df48fdfe5f6f92aa0e`
- Product version: `1.0.2`
- Consumes `BKE.Desktop.Licensing 2.0.1`.
- Includes preserved-authority recovery certification kit.
- Remains DRAFT / UNMERGED.

Important: the first real recovery gate does **not** require reinstalling Licensing Agent. SDK 2.0.1 treats both the old installed-Agent reason `unverifiable_signed_lease` and the newer `lease_version_rejected` as recoverable.

---

## 3. Biggest platform upgrades already achieved

### 3.1 Licensing Agent .NET 10 convergence

The active Windows Agent architecture has moved from the former Python/PyInstaller runtime to the .NET 10 Generation 2 stack.

Established capabilities include:
- .NET 10 Windows service/runtime.
- Agent-owned native License Center.
- .NET privileged updater and provisioner.
- persistent ProgramData state preservation.
- loopback-only product-facing authority.
- strict exact-version signed lease checks.
- Ed25519 trust verification.
- signed update policy verification.
- signed install-target policy verification.
- approved BKE install roots.
- SHA-256 artifact verification.
- staged replacement and rollback.
- real Windows ARM64 install/reboot evidence.

The Render Dock stale-authority incident proved the preserved database/key/lease/binding were not corrupted by the migration. The failure was a lifecycle/recovery state-machine defect.

### 3.2 Recoverable signed-authority states

Target recovery flow:

```text
stale / expired / version-mismatched signed authority
        ↓
recoverable fail-closed denial
        ↓
BKE.Desktop.Licensing = RecoveryRequired
        ↓
Agent-owned License Center
        ↓
fresh exact-version authority
        ↓
reauthorize
        ↓
launch only when authorized=true
```

Products must not tell a healthy client to reinstall Licensing Agent merely because the commercial authority needs renewal/recovery.

### 3.3 Agent becomes the managed-software bootstrap

The long-term customer machine should require manual installation of **only BKE Licensing Agent**.

After that:

```text
BKE Licensing Agent
        ↓
install / repair / update BKE Launcher
        ↓
BKE Launcher
        ↓
request Agent-managed install / update of BKE products
```

The Launcher remains unprivileged. The Agent owns the trusted privileged package boundary.

The current updater/provisioner foundation should evolve from update-only semantics into:

```text
Install
Update
Repair
Rollback
Uninstall (later)
```

---

## 4. Existing V2 organization/account foundation

Organization support is already substantially wired and should be retained rather than rebuilt.

Existing account capabilities include:
- Personal and Organization customer accounts.
- Organization creation.
- email invitations.
- invitation accept/resend/revoke/expire.
- roles: `OWNER`, `BILLING`, `LICENSE_MANAGER`, `MEMBER`.
- member role changes/removal.
- ownership transfer.
- account lifecycle handling.
- switchable accounts.
- account-scoped authorization.
- audit logging.

Commercial licensing is already account-aware through:
- `Order.accountId`
- `Subscription.accountId`
- `License.accountId`
- `License.maxSeats`
- `License.maxDevicesPerSeat`
- `LicenseAssignment(licenseId, userId)`

Therefore buyer email and software-user email do not need to match.

---

## 5. The V3 convergence problem

Current runtime activation is still key-centric:

```text
licenseKey
+ installationId
+ deviceId
+ productVersion
        ↓
activation
        ↓
signed lease
```

V2 also already contains the generic Entitlement domain:

```text
Entitlement
- subjectId
- resourceId
- sourceReference
- quantity
- scopeSnapshot
- grantSnapshot
- validFrom
- validUntil
```

V3 should converge the current `License` commercial model and the newer `Entitlement` ownership model instead of creating a third parallel concept.

---

## 6. Canonical V3 commercial model

### 6.1 Direct purchase

Checkout should offer:

```text
Who is this for?

● My Personal Account
○ An Organization I can purchase for
○ Buy as Claim Code
```

If Personal or Organization is selected, successful payment creates/adopts the entitlement directly for that CustomerAccount.

Payment email is payment/contact evidence. It does **not** define ownership.

### 6.2 Buy as Claim Code

Target flow:

```text
payment succeeds
    ↓
unclaimed claim unit created
    ↓
single-use BKE Claim Code issued
    ↓
recipient signs into BKE
    ↓
chooses Personal Account or Organization
    ↓
claim transaction commits
    ↓
Entitlement becomes account-owned
    ↓
Claim Code permanently consumed
```

Claim Code lifecycle:

```text
AVAILABLE
   ↓
CLAIMED / CONSUMED
```

After successful claim, the code has **zero runtime authorization value**.

Recommended durable Claim Code properties:
- id
- codeHash / keyed hash
- commercial source / order reference
- product/right reference
- status
- expiresAt
- claimedAt
- claimedByUserId
- claimedToAccountId
- revokedAt
- createdAt

Plaintext Claim Code must not remain the long-term software authority.

### 6.3 Claim is not transfer

- **CLAIM** = assigns a previously unowned/claimable purchase exactly once.
- **SEAT ASSIGNMENT** = grants usage while account/organization ownership remains unchanged.
- **TRANSFER** = changes ownership of an already-owned entitlement and is a separate governed workflow.

Actual transfer must account for active devices, assignments, leases, renewals, subscriptions, invoices, and audit history.

---

## 7. Reseller model

Resellers should receive **claim inventory**, not normal end-user licenses attached to the reseller account.

```text
BKE Reseller
    ↓
50 × Render Dock claim units
    ↓
sell one unit
    ↓
customer receives Claim Code / claim invitation
    ↓
customer signs into BKE
    ↓
customer chooses Personal or Organization destination
    ↓
claim commits
    ↓
customer account owns entitlement
```

Once claimed, the reseller does not automatically retain authority over customer devices or rights unless a separate support/reseller permission explicitly grants it.

---

## 8. Identity and authentication

### Canonical identity rule

Use **email as the primary human-facing identifier**, but keep an immutable internal BKE `userId` as the canonical person identity.

Authentication identities can include:
- Continue with Email.
- Google OAuth.
- future Microsoft/other providers.

Google/Gmail OAuth is an **authentication method, not licensing authority**.

Entitlements remain attached to CustomerAccount/Organization IDs, not raw email strings and not OAuth access tokens.

Target identity relationship:

```text
BKE User
├─ immutable userId
├─ primary verified email
└─ authentication identities
    ├─ email verification/password/OTP
    ├─ Google OAuth
    └─ future providers
```

Changing sign-in method must not change organization memberships, assignments, entitlements, installations, or leases.

Important distinctions:
- payer email ≠ entitlement owner
- login email ≠ organization owner
- member email ≠ purchasing email
- CustomerAccount/Organization is the commercial ownership boundary

---

## 9. V3 runtime licensing

Target replacement for normal license-key activation:

```text
authenticated BKE user
        ↓
selected accessible Personal / Organization account
        ↓
Entitlement
        ↓
Assignment / seat policy
        ↓
device + installation
        ↓
version-bound signed lease
        ↓
local Agent authorization
```

Traditional license keys are therefore retired as the normal runtime authority.

Existing legacy keys should remain temporarily supported only for migration/adoption.

---

## 10. Legacy license migration

Do not abruptly invalidate existing customers.

Migration path:

```text
Legacy License Key
        ↓
Claim existing purchase
        ↓
select Personal / Organization account
        ↓
create/adopt canonical Entitlement
        ↓
retire old key from runtime authorization
```

---

## 11. Agent-managed Launcher target

Customer experience:

```text
install BKE Licensing Agent once
        ↓
sign into BKE
        ↓
Agent resolves accessible accounts/orgs
        ↓
Agent installs BKE Launcher if missing
        ↓
Launcher displays selected account library
```

Launcher responsibilities:
- account selector.
- owned/assigned product library.
- Install / Launch UX.
- Request Access UX.
- update/repair presentation.

Launcher does **not** own:
- privileged mutation.
- trusted download policy.
- signing authority.
- raw license/claim secrets.
- local authorization authority.

---

## 12. Ownership boundaries

**Digital Solutions** owns:
- identity/account relationships.
- organizations.
- commerce.
- entitlement state.
- assignment policy.
- remote commercial authority.

**Licensing Agent** owns:
- trusted local authorization.
- device/install state.
- signed leases.
- trusted package execution.
- rollback.
- Launcher bootstrap.

**BKE Launcher** owns:
- customer software-library UX.

**Products** own:
- product behavior.

---

## 13. V3 implementation phases

### Phase A — Identity/account sign-in
- retain immutable BKE user IDs.
- verified email as human-facing identity.
- Continue with Email.
- Google OAuth linked to the same BKE user.

### Phase B — Claim Code domain
- explicit Claim Code / Claim Unit state.
- one-time transactional claim.
- destination Personal Account or accessible Organization.
- permanent consumption after successful commit.
- replay protection and audit.

### Phase C — Entitlement convergence
- Account/Organization becomes canonical entitlement subject.
- product/right/plan becomes entitlement resource/scope.
- preserve seat/device policy.
- progressively demote legacy `License` semantics instead of destructive rename.

Transition:

```text
TODAY
License = right + key + seats

TRANSITION
License = legacy commercial record
Claim Code = acquisition / compatibility token
Entitlement = canonical right

FINAL
Entitlement = ownership authority
Assignment = usage delegation
Signed Lease = local runtime proof
```

### Phase D — Agent authenticated account session
- Agent authenticates BKE user.
- resolve accessible accounts.
- resolve entitlement/assignment.
- issue/refresh signed exact-version lease.

### Phase E — Agent-managed Launcher bootstrap
- model Launcher as managed platform component.
- add first-install transaction.
- Agent installs/updates/repairs Launcher.
- Launcher remains unprivileged.

### Phase F — legacy adoption
- existing keys remain functional during migration window.
- existing keys can be claimed into account-owned Entitlements.
- retire old key from runtime authorization only after successful adoption.

### Phase G — reseller inventory
- reseller claim-unit inventory.
- one-time claim codes or claim invitations.
- customer-owned entitlement after claim.

---

## 14. Locked design rules

1. **Account/Organization is ownership authority.**
2. **Email identifies people; immutable BKE userId is canonical identity.**
3. **Google OAuth is sign-in, not licensing authority.**
4. **Claim Codes are one-time acquisition/claim secrets, not runtime license keys.**
5. **Successfully claimed codes are permanently consumed.**
6. **Organization seat assignment is not ownership transfer.**
7. **Ownership transfer is a separate governed workflow.**
8. **Payment email does not automatically determine entitlement ownership.**
9. **Licensing Agent owns local trusted authorization and privileged package execution.**
10. **Launcher owns UX and remains unprivileged.**
11. **Products launch only after valid signed authorization.**
12. **Avoid destructive schema rewrite merely to rename the legacy License model.**

---

## 15. Current guardrails

Until separately authorized:

- NO merge of SDK PR #13.
- NO merge of Licensing Agent PR #39.
- NO merge of Render Dock PR #19.
- NO production deployment.
- NO production DB mutation.
- NO destructive migration.
- NO force push.
- NO production signing cutover.
- NO manual signed-lease edit.
- NO manual active-binding rewrite.
- NO generic Licensing Agent reinstall as recovery.

---

## 16. Immediate next action

Do **not** start V3 implementation yet.

Complete the Render Dock preserved-authority certification first:

```powershell
powershell `
  -ExecutionPolicy Bypass `
  -File .\windows_preserved_authority_recovery.ps1 `
  -Mode InstallAndPrepare
```

Then:

```powershell
powershell `
  -ExecutionPolicy Bypass `
  -File .\windows_preserved_authority_recovery.ps1 `
  -Mode Exercise
```

Operator must **CANCEL** the License Center in the first exercise gate.

Finally:

```powershell
powershell `
  -ExecutionPolicy Bypass `
  -File .\windows_preserved_authority_recovery.ps1 `
  -Mode Collect
```

Only a PASS permits the real 1.0.2 activation gate and subsequent V3 work.
