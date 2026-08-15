# SSH and firewall hardening

This runbook defines the repository-owned host baseline. It is read-only by default and does not enable, disable, or modify host services.

## Required baseline

- Use a dedicated non-root sudo operator account.
- Install the operator's Ed25519 public key before changing SSH policy.
- Disable direct root login and password authentication only after a second key-authenticated session is verified.
- Restrict SSH (TCP/22) to an owner-approved source range when practical. Never expose PostgreSQL, Valkey, MinIO, Docker, or application-internal ports publicly.
- Allow only TCP/80 and TCP/443 for the public reverse proxy, plus the approved SSH source range.
- Enable the host firewall with default-deny inbound and default-allow outbound policy.
- Enable unattended security updates and keep Docker enabled at boot.

## Safe verification

From the VPS, run the non-mutating audit script as root or with approved sudo:

```sh
sudo ./scripts/audit-host-security.sh
```

The script reports SSH effective settings, firewall state/rules, Docker boot state, and exposed listening ports. It never prints private keys, environment values, or command secrets. A `FAIL` requires remediation and a rerun. A `WARN` is an explicit owner decision, not an automatic pass.

## Change procedure

1. Record the change ticket, operator, UTC time, source range, and rollback plan.
2. Open a second SSH session using the approved key and keep it open.
3. Apply one host change at a time through the provider console or approved configuration management.
4. Re-run the audit and capture the output in the evidence record below.
5. Close the original session only after key login and sudo access are confirmed.

Do not run firewall or SSH changes from an unverified session. Do not paste `sshd_config`, authorized keys, IP allowlists, or provider credentials into public issues.

## Evidence record

Copy this template into the owner-controlled evidence store, not into Git with sensitive values:

```text
Control: SSH/firewall host baseline
Host identifier: <non-secret asset ID>
Operator: <name or ID>
Observed UTC: <timestamp>
OS/image: <version>
SSH key login verified in second session: PASS/FAIL
Root login disabled: PASS/FAIL
Password authentication disabled: PASS/FAIL
Firewall default inbound deny: PASS/FAIL
Allowed inbound ports/source ranges: <approved summary>
Unexpected public listeners: PASS/FAIL
Docker enabled and active: PASS/FAIL
Audit command exit code: <code>
Audit output hash: <sha256>
Exceptions/expiry/owner approval: <none or reference>
```

Repository inspection and this script cannot certify a real VPS. The owner must supply the host evidence and approve any exceptions.
