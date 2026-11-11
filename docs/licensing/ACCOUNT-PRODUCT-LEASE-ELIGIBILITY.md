# Wave 1 — DS account-product lease eligibility gate (source-only L2)

**State:** implementation in progress; NO EXECUTION LEASE ISSUANCE or live endpoint until separately authorized immutable `@bke/licensing` release and signing/audit policy.

**Issue authority:** [Digital Solutions #340](https://github.com/jan2xo/bke-digital-solutions/issues/340). Shared library [PR #90](https://github.com/jan2xo/bke-libraries-typescript/pull/90) SHA `03dfbbae3a5e4acc95b82e323940555d85cdcf42` is certified but unmerged/unreleased. Agent [PR #120](https://github.com/jan2xo/bke-licensing-agent/pull/120) SHA `5895f574b77e8c263cd452e6a713045b15e0ecad` L1 verified but unmerged. This DS wave pins their contract behavior for reference without importing unreleased source into production.

**Behavioral owner:** DS account/session identity, entitlement rights, assigned seat and subscription/trial policy; signed JWS library stays reusable. This wave implements fail-closed eligibility only, not the real lease signer or public endpoint.

**Security invariants:** session derived from validated server access token, never request-account claims; active customer account / authorized user; active product and published release; active scoped durable entitlement; active matching license and assigned organization seat; subscription active/current and trial unrevoked/in window; expiry ceiling no later than every authoritative right; deny unknown type/source; negative cases always reject.

**Certification graph (finalize exact head):** PR scoped tests + core + licensing + entitlements + native-account (auth/entitlement shared boundary). Not required: payments, installer, Agent/Launcher binaries, production providers, package release. Cross-repo: reuse certified upstream L1 exact-SHA proof; do not dispatch unrelated Agent/Library graphs.

**Production:** LOCKED; no production deploy, DB mutation, key cutover, real payment/email, installer/release publication.
