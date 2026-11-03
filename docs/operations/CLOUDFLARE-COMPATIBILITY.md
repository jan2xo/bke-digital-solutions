# Cloudflare Workers Free compatibility proof

This document tracks the first hosting-migration intent. It is not deployment approval or evidence that Digital Solutions runs on Workers.

## Accepted result and boundaries

Starting source: `a36d9decffa6936114a9578857558a9687ca4e7f` on canonical `main`.

The owner authorized implementation from the 2026-11-03 V3 free-tier handoff, accepted a fresh database, and retained Docker as an optional cold target. The initial application-infrastructure objective is USD 0 for 1–3 customers. Paid upgrades, metered subscription activation, production cutover, live credentials and native Agent changes are outside this intent.

Required PR1 evidence:

| Requirement | Required receiving-path proof | Boundary |
|---|---|---|
| Framework | Existing V3 SSR/dynamic browse and authenticated dashboard, cookies, CSP/nonce, server-only/runtime configuration and static-asset routing | Actual application build and workerd; deployed staging remains separate |
| Identity | Existing Argon2id parameters and PHC compatibility; valid/invalid/malformed inputs through both identity composition sites; second/concurrent invocations | Node and Workers runtime interoperability |
| Persistence | Real PostgreSQL transaction/rollback through the chosen Workers/Hyperdrive adapter, with fresh authorization reads and safe client lifetime | Isolated database/runtime proof; no schema/history rewrite |
| Licensing | Existing Ed25519 lease/policy producer and Agent-compatible test vectors; invalid/expired/wrong-scope inputs rejected by actual consumers | Source/runtime vectors; physical/native Agent testing remains separate |
| Resources | CPU profiles, startup, bundle and memory evidence for representative operations and concurrency; explicit comparison against Free constraints | Wall-clock timers or local configuration alone cannot prove deployed CPU enforcement |
| Jobs and portability | Bounded scheduled entrypoint plus retained Node production behavior | No always-on host, no new commercial truth/cache authority |

Map the existing Agent lease/auth/account/application-session lifetimes, trusted clock, local reuse, renewal, grace and revocation semantics before proposing any changes. A 24-hour process session must not extend a signed lease or bypass an existing refresh rule.

Use the existing PostgreSQL/capability/security contracts. Preserve rate limiting, recent authentication, same-origin checks, audit boundaries and Docker source. Do not replace the product with a toy endpoint, weaken password parameters, introduce D1, modify Prisma schema/history or add automatic paid upgrades to obtain a pass.

## Execution and evidence

Use the existing intentional GitHub certification mechanism and bind results to the exact candidate source. Candidate workflow definitions and checked-out source can differ on comment-triggered runs; inspect what actually executed. Record implementation/checkpoint/run details in the PR conversation.

A source milestone may be implemented while the parent migration remains PARTIAL. The complete PR1 acceptance cannot be called PASS if required application/runtime, CPU or database proof is missing. On a demonstrated incompatibility, retain the smallest reproducible evidence and identify the exact failing operation. Do not advance to unrelated later waves around a failed feasibility gate.

Status at creation: requirements recorded; implementation and all proof PENDING. Production remains LOCKED. The handoff's later runtime-adapter, Agent efficiency, storage/jobs, provisioning/observability and release stages remain unimplemented by this document.
