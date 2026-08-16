# BKE Digital Solutions + BKE Licensing Agent — Master Completion Roadmap

## SELLING MVP — GO-LIVE CRITICAL PATH

PayMongo LIVE is implemented, live, and owner-verified; sandbox credentials are
not a launch prerequisite. The launch path is: payment → webhook settlement →
entitlement/license issuance → trusted release publication gate (hash, current
CLEAN evidence, SBOM/provenance, signature, canonical manifest) → secure
download → installation → activation → Agent Active License Binding → signed
lease → AuthorizationDecision → restart/offline verification → update
authorization. Repository controls are implemented/local-certified where
recorded; production provisioning and VPS certification remain owner-controlled.
The current certification mock browser failure is classified as repository
test/runtime evidence only and does not downgrade PayMongo LIVE.

### TRUSTED RELEASE PUBLICATION GATE

The canonical release invariant is: artifact hash → current CLEAN malware
evidence → stale-evidence invalidation on mutation → SBOM/provenance → release
signature → canonical manifest → publication eligibility → private download
grant. Repository implementation and local certification are distinct from
production scanner/key provisioning and production certification.

Status: planning baseline; Phase 3 certified PASS (2026-08-13). This reconciles both repositories; it does not authorize deployment or Phase 4.

## Ownership and invariants

- Digital Solutions owns commerce, entitlement, subscription state, signed lease issuance, release governance, and provider workflows.
- Licensing Agent owns lease verification, Verified License Repository, Active License Binding, and `AuthorizationDecision`.
- Products consume only `AuthorizationDecision`; they never inspect leases, signatures, or Agent storage.
- Entitlements are independent of release lifecycle; draft releases must not disable a stable release.
- Agent products remain product-agnostic and consume `bke.manifest.json` plus the typed protocol.

## Current capability matrix

| Capability | Repository state | Evidence/gate |
|---|---|---|
| Commerce, checkout, refunds, invoices, downloads | Implemented | Local/certification evidence; provider evidence scoped |
| Subscriptions, trials, offers | Implemented | Deterministic coverage; payment certification remains |
| Commercial signed leases/lifecycle | Implemented | Real-Agent lifecycle certification required |
| `bke.licensing.v1` | Frozen in Digital Solutions | Synchronize/certify in Agent repository |
| Agent verification/binding/authorization | Separate repository | Cross-repository certification |
| Products, releases, artifacts, safe deletion | Implemented | Deployment evidence pending |
| SBOM, provenance, signatures, malware evidence | Implemented gates | Production scanner/certificates pending |
| Legal Center/consent history | Implemented | Professional review pending |
| Scheduler/lifecycle jobs | Implemented | Operational deployment evidence pending |
| Backup/DR | Implemented | CREATE, VERIFY, SIMULATE_RESTORE, RESTORE_ISOLATED passed in certification; production RPO/RTO pending |
| Observability/security | Implemented | Production monitoring/alert delivery pending |
| VPS/HTTPS/Cloudflare | Not deployed | Phase 22 external work |

## Phases 0–22

0. **Truth audit and capability matrix** — reconcile both repositories and evidence; owner-approved baseline.
1. **Backup and disaster recovery** — encrypted PostgreSQL/MinIO archives, manifests, retention, verification, simulation, isolated restore. Repository and certification restore complete; production drill/RPO/RTO pending.
2. **Release and artifact lifecycle** — product/version/release states, immutable artifact identity, safe deletion, and canonical eligible-release resolution. Implemented and Phase 2 certified; deployment evidence pending.
3. **Supply-chain evidence** — SBOM, provenance, signatures, malware scanner evidence, dependency integrity. Gates implemented; production keys/scanner pending.
4. **Administrator plane** — MFA, audit, provider credentials, compliance, supply-chain, backup, monitoring, scheduler controls. Implemented; operational certification pending.

Phase 4 malware/artifact security pipeline: repository implementation complete;
ClamAV provisioning and production certification remain pending.
5. **Subscription lifecycle** — renewal, expiration, grace, trials, refunds, idempotent provider events. Implemented; PayMongo evidence remains.
6. **Commercial lease lifecycle** — activation, refresh, renewal, transfer, revocation, replacement, key rotation. Implemented in Digital Solutions; Agent runtime certification remains.
7. **Device identity and limits** — commercial eligibility versus Agent binding. Implemented foundation; product/Agent evidence remains.
8. **Cloud↔Agent API** — typed activation, refresh, revocation, transfer, key discovery, errors, versioning. Contract documented; certify against real Agent.
9. **Signed lease contract** — canonical bytes, Ed25519, key IDs, lifecycle semantics. Frozen here; synchronize in Agent repository.
10. **Manifest/product identity** — `bke.manifest.json`, product IDs, versions, install/device semantics. Agent-side compatibility gate.
11. **Agent completion** — repository, binding, authorization, offline behavior, multi-license selection. Agent repository work/certification.
12. **Digital Solutions↔Agent integration** — end-to-end lease issuance through real Agent runtime. Cross-repository gate.
13. **Forge boundary** — packaging and Agent integration without authorization duplication. Downstream product certification.
14. **Installation/first activation** — installer identity, activation, offline cache, recovery. Downstream product certification.
15. **Update continuity** — updates preserve identity, license, and binding. Downstream product certification.
16. **PayMongo certification** — success, failure, refund, replay, reconciliation, provider limits. Partially provider-certified.
17. **Email delivery** — Resend production sender, OTP, receipts, licenses, recovery. Implementation exists; production evidence pending.
18. **Security certification** — headers, sessions, MFA, CSRF/origin, uploads/downloads, secrets, limits. Controls implemented; deployment review pending.
19. **Operations** — Docker boot/restart, scheduler, backup worker, logs, metrics, alerts, runbooks. Local/certification evidence; VPS pending.
20. **End-to-end commerce/licensing** — registration→payment→webhook→license→download→Agent authorization. Local evidence; real-provider/product evidence pending.
21. **Final release gate** — integrity, compliance, backup, migration, approvals, rollback. Gates implemented; production evidence incomplete.
22. **Production deployment and handoff** — VPS, HTTPS, secrets, backups, monitoring, rollback, cold reboot. Not started by design.

## Dependencies and launch classification

`0 → (1–10) → 11 → 12 → (13–19) → 20 → 21 → 22`.

Phases 1–5 and 16–19 can run in parallel after Phase 0. Phases 8–12 require the real Agent repository. Phase 20 depends on commerce, payments, email, leases, Agent, and security. Phase 21 blocks release; Phase 22 is infrastructure execution.

**Critical blockers:** real-Agent lifecycle certification; PayMongo/Resend production evidence; production signing certificates/scanner; legal/privacy/tax approvals; production restore/RPO/RTO; VPS/HTTPS/monitoring/cold-reboot evidence.

**High priority:** release-gate evidence, install/update integration, incident response, restore rehearsal. **Medium:** support and organization administration. **Nice-to-have/Version 7:** richer compliance workflows, reviewer timelines, version comparison, notifications, and UX polish.

## Recommendation

Do not start a feature phase automatically. Obtain owner review, then pursue the smallest outstanding evidence gate. Agent-owned phases must not be reimplemented here, and historical reports must remain historical.
- Phase 3 — Product Verification & Supply-Chain Signing is implemented in the repository: protected server-side signing, deterministic manifests, independent verification, idempotent evidence, and canonical release gating. Owner review is pending; production scanner/certificate provisioning remains deferred.
Phase 5 implementation and certification are complete for the current control-plane scope. The rebuilt certification stack was healthy; control-plane browser checks passed, certification Vitest passed 187 tests with 6 credential-gated skips, and static/Prisma/security checks passed. Production provider credentials, scanner provisioning, and VPS deployment remain external gates.
### Phase 5.5 — Production authentication and provider resilience

PASS — owner-provided certification runtime verified normalized provider failure
evidence, fail-closed MFA delivery, provider observability, recovery-code
status/UX and replay/regeneration, and sensitive-data non-exposure. Vitest
passed 194 tests with 6 credential-gated skips; Core Playwright 11/11, Phase 4
2/2, and Phase 5 control-plane/scanner lifecycle checks passed. No
authentication bypass was introduced. Production provider credentials and
deployment certification remain external.
### Phase 5.6 — Administrator emergency recovery

PASS — deployment-only emergency MFA reset certified against disposable
certification data. State invalidation, password/role preservation, sanitized
operator audit evidence, unknown-target rejection, and forced re-enrollment
were verified. No public bypass or `ALLOW_BREAK_GLASS` reuse was introduced.
