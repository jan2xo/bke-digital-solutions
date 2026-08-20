# Incident response runbook

This runbook is for suspected compromise, credential exposure, account takeover, payment abuse, malware, data loss, or service outage. It is an operational guide, not a claim that production response has been exercised.

## Severity and first actions

| Severity | Examples | Initial owner |
| --- | --- | --- |
| SEV-1 | active credential compromise, confirmed breach, payment fraud, destructive data loss | incident commander immediately |
| SEV-2 | suspected compromise, malware alert, admin takeover attempt, prolonged provider outage | on-call operator and security owner |
| SEV-3 | isolated suspicious event or degraded control with workaround | service owner |

1. Open an incident record with UTC start time, environment, affected service, reporter, and correlation ID.
2. Declare an incident commander and communications owner. Use the emergency contact tree maintained outside Git.
3. Preserve logs, audit events, provider notices, deployment commit, and relevant hashes. Do not alter or delete evidence.
4. Contain narrowly: revoke exposed credentials/tokens, suspend affected sessions or accounts, disable compromised integrations, or isolate a host. Do not destroy volumes or reboot an affected host unless safety requires it.
5. Escalate payment, privacy, legal, tax, or customer-notification decisions to the approved owner/professional. Never make an unsupported regulatory claim.

## Playbooks

### Credential leak or provider compromise

- Stop using the exposed value and record where it was found without copying it into the incident record.
- Revoke and reissue the provider credential through the provider console.
- Rotate the application encryption/master key only with an approved migration and recovery plan.
- Validate the replacement, inspect provider activity, and confirm old credentials no longer work.
- Review sessions, audit events, webhooks, email/payment outbox, and deployment history for the exposure window.

### Administrator account takeover

- Revoke administrator sessions and disable the affected account if safe.
- Preserve security events and authentication logs.
- Require fresh password and MFA enrollment through the normal protected flow.
- Use `npm run admin:recover-mfa` only for catastrophic lockout, with owner authorization and the documented acknowledgement. It is not a compromise bypass.

### Payment or webhook abuse

- Disable affected provider configuration or webhook path only after confirming the blast radius.
- Do not refund, reconcile, or alter immutable payment evidence solely from an unverified alert.
- Compare provider-side events with local attempts, normalized events, audit records, and outbox state.
- Escalate customer and financial decisions to the owner/accounting contact.

### Malware, breach, or data loss

- Isolate the host or service while preserving forensic evidence.
- Do not run cleanup scripts, delete containers, prune volumes, or overwrite backups until evidence is preserved.
- Rotate potentially exposed credentials from a trusted workstation.
- Restore only into an isolated target first. Verify manifests, signatures, malware scan results, migrations, and data integrity before considering production recovery.

## Recovery and closure

1. Confirm containment with fresh audit output and provider-side confirmation.
2. Apply a reviewed fix, deploy the approved commit, and run health, authentication, payment/webhook, backup, and monitoring checks relevant to the incident.
3. Record impact, timeline, root cause, controls changed, evidence references, customer/regulatory decisions, and follow-up owners.
4. Close only when the incident commander and owner approve residual risk and deadlines.

Never include secrets, raw webhook bodies, license keys, recovery codes, signed URLs, or object keys in tickets, logs, screenshots, or Git. Real response drills and production acceptance require owner-controlled systems and are not satisfied by repository tests alone.
