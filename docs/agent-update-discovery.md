# Agent update discovery

`POST /api/agent/updates/check` is the machine-facing HTTPS discovery boundary for installed BKE products. It requires the current signed lease envelope and exact product/version/platform/architecture/channel context.

Digital selects one semantically newer publishable release with exactly one active artifact. Current release-readiness and the stored signed `bke.supply-chain.v1` envelope must verify before Digital issues a short-lived download grant and the existing `bke.update-policy.v1` execution policy. The policy is Ed25519-signed and binds product, versions, platform, architecture, channel, release, artifact hash/size, and monotonic release revision.

The Licensing Agent must verify the policy and artifact. Product applications never receive this remote response and never call this route directly. A discovery failure does not affect signed offline authorization.

This route does not implement mandatory-update licensing policy. `minimum_supported_version` is the installed version for this availability-only phase; licensing accepted-version fields remain independent.
