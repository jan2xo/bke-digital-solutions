# Provider master-key management

`PROVIDER_CREDENTIALS_ENCRYPTION_KEY` is the root secret for database provider credentials. Keep it outside PostgreSQL, Git, Docker images, logs, backups of application configuration, and browser-visible variables. Supply at least 48 random characters through the deployment secret store. `PROVIDER_CREDENTIALS_KEY_VERSION` identifies the active key version.

Ciphertext uses AES-256-GCM, a fresh 96-bit nonce, a SHA-256-derived 256-bit encryption key, and authenticated associated data containing the key version. The envelope is `v1.<nonce>.<tag>.<ciphertext>` using base64url components. Authentication or key-version failure produces a typed failure and never falls back silently.

For a planned manual rotation, retain old key material temporarily as a JSON object in `PROVIDER_CREDENTIALS_PREVIOUS_KEYS`, keyed by version, set a new active key and version, then replace each provider credential through the admin portal. Verify no active credential references the old version before deleting the previous key. Automatic re-encryption and automatic master-key rotation are intentionally out of scope.

If the active master key is lost, encrypted credentials cannot be recovered. Disable the database source or restore the correct key, revoke provider-side credentials, issue new provider credentials, and save replacements. Never weaken decryption or copy plaintext into the database as a recovery shortcut.
