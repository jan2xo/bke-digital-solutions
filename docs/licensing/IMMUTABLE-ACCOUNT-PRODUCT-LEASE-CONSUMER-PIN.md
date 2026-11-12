# Immutable Licensing 0.10.0 — Digital Solutions consumer adoption

**Owner:** Digital Solutions licensing authority. **Scope:** immutable shared-library consumer upgrade only; no signed lease issuance or production key changes.

## Exact upstream dependency and recorded proof

- Upstream: [`jan2xo/bke-libraries-typescript` GitHub Release `licensing-v0.10.0`](https://github.com/jan2xo/bke-libraries-typescript/releases/tag/licensing-v0.10.0), release ID `442576730`.
- Release state verified independently: `draft=false`, `immutable=true`; four original uploaded assets.
- Pinned tarball `bke-licensing-0.10.0.tgz`, SHA-256 `4d2f8e4295effcfd4aa3b6492944e8dbba3ec75e86c83727a30daa74e4f75d60`.
- The npm lockfile's `sha512-` integrity is derived from the **same original certified tarball bytes**, not from a rebuilt or untrusted artifact: `sha512-3cumWOHW687GE1hPcCeCV2t7w69pQt7qssxLkZY2zHkYHb/tUyF+bdMn7CkL6UuZa5L1YEPtRuCLZP63TO5vlw==`.
- Original package producer: [run #43153573142](https://github.com/jan2xo/bke-libraries-typescript/actions/runs/43153573142); exact package source SHA `d6b0159d9c22e0f9e468040777ea4591953c89f6`. Read-only release readiness [run #43168709538](https://github.com/jan2xo/bke-libraries-typescript/actions/runs/43168709538) PASS; final immutable-release recovery [run #43171383139](https://github.com/jan2xo/bke-libraries-typescript/actions/runs/43171383139) PASS. [Canonical release checkpoint](https://github.com/jan2xo/bke-digital-solutions/issues/340#issuecomment-6816998085).

## Consumption proof

Only the root direct dependency `@bke/licensing` is changed from GitHub `licensing-v0.9.0` to `licensing-v0.10.0` and the matching root + installed package lock entry. The shared package's declared dependencies (`pg` and `semver`) remain unchanged. The test-only consumer smoke exercises the actual **installed** exported `bke.product-lease.v1` Ed25519 signing and verification contract with ephemeral test keys and rejects altered claims/signatures. This is cryptographic contract compatibility, **not** proof that Digital Solutions signs leases in production.

DS already has an internal server-owned lease preparation transaction that binds real Agent proof, entitlement and `PREPARED`/`DENIED` audit (merged PR #359). It does **not** produce a JWS. The new upstream library only becomes a versioned import the host can use in a subsequent independently certified signing / `ISSUED` audit wave.

## Future trust boundary (separate certification intent)

Future DS issuance must validate account/session/entitlement and live Agent machine-key challenge, own signer key custody/rotation, ensure issued JWS is atomically recorded as `ISSUED` in the same serializable authorization transaction, reject audit/commit failures, never log secret keys/JWS/bearers, and introduce a separately certified authenticated issuance endpoint. The product/Agent must enforce local signature, identity, key binding, action and hard expiry. Do not treat `PREPARED` as issued.

**Production/activation:** LOCKED. No signing key provisioning or cutover, HTTP issuance route, real provider traffic, live DB writes, installer/catalog activation or npm package publication in this consumer pin.
