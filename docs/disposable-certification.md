# V3 disposable LAN certification

This profile is for local pre-production integration between the Mac-hosted Digital Solutions V3 runtime and a disposable Windows test machine. It does not use production PayMongo, Resend, databases, signing keys, or public infrastructure.

## Authority

The disposable authority is:

```text
https://bke-v3.test:8443
```

The Mac runs the Docker application stack and Caddy. A Windows test machine maps `bke-v3.test` to the Mac LAN address and trusts only the disposable development CA.

## Local-only material

The repository expects an ignored directory:

```text
.bke-disposable/
  secrets.env
  signing/
    license-signing-private.pem
    license-signing-public.pem
    supply-chain-signing-private.pem
    supply-chain-signing-public.pem
  tls/
    bke-v3-disposable-ca.crt.pem
    bke-v3.test.crt.pem
    bke-v3.test.key.pem
```

Never commit this directory. The environment materializer verifies both Ed25519 keypairs, the TLS hostname/keypair, and the CA relationship before writing the ignored `.env.certification`.

If `.env.certification` already exists without the disposable marker, the materializer refuses to overwrite it.

## One-command startup

```bash
./bke.sh disposable-up
```

The command:

1. materializes the disposable environment without printing secrets;
2. validates Compose configuration;
3. starts PostgreSQL, Valkey, and MinIO;
4. applies migrations;
5. runs the seed;
6. builds and starts the app, scheduler, backup worker, and Caddy;
7. validates TLS and readiness; and
8. performs a real `bke.account-session.v1` device-start probe.

The final success marker is:

```text
DISPOSABLE CERTIFICATION GATE: PASS
```

Other operations:

```bash
./bke.sh disposable-doctor
./bke.sh disposable-status
./bke.sh disposable-logs
./bke.sh disposable-smoke
./bke.sh disposable-down
./bke.sh disposable-reset
```

`disposable-reset` removes Docker containers and volumes but preserves `.bke-disposable`.

## Windows boundary

On the Windows test machine:

1. map `bke-v3.test` to the current Mac LAN IP;
2. import `.bke-disposable/tls/bke-v3-disposable-ca.crt.pem` into the test machine trust store;
3. configure the Licensing Agent authority as `https://bke-v3.test:8443`; and
4. keep the Agent environment explicitly disposable/test-only.

Do not import the disposable CA onto production machines.

## Provider boundary

This profile hard-locks:

```text
PAYMENT_PROVIDER=mock
PAYMONGO_SECRET_KEY=
PAYMONGO_WEBHOOK_SECRET=
PAYMONGO_LIVEMODE=false
EMAIL_PROVIDER=log
RESEND_API_KEY=
```

Provider certification with genuine PayMongo TEST or Resend credentials is a separate gate and must not be mixed into this disposable LAN profile.
