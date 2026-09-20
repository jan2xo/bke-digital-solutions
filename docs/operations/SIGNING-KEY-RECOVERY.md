# Signing-Key Recovery

Keep an owner-controlled inventory of key IDs, public keys, activation and
retirement dates, and private-key custody. `LICENSE_SIGNING_*` signs leases;
`SUPPLY_CHAIN_SIGNING_*` signs release evidence. Never reuse, print, commit, or
store private keys in PostgreSQL.

If a private key is lost, do not regenerate it and expect historical signatures
to verify. Preserve the retired public key, use the authenticated rotation
workflow for a new key ID, reconfigure the VPS secret store, and verify
`/api/licensing/keys` plus a protected signing operation.
