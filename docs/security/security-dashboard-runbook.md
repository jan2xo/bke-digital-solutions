# Administrator security dashboard runbook

Open `/admin/security` after completing administrator MFA. Recent authentication is required before revoking sessions.

- Confirm the current session label before taking action.
- Use **Revoke** for one browser, **Revoke other sessions** to preserve the current browser, or **Sign out everywhere** to revoke all sessions and clear the current cookie.
- Review authentication failures, recovery-code use, provider validation failures, and critical events in the timeline. Signals request review; they are not proof of account compromise.
- If activity is not recognized, sign out everywhere, reset the password, regenerate recovery codes, re-enroll MFA if necessary, rotate affected provider credentials, and preserve audit/security records.
- Run the email outbox worker and confirm high-impact notifications are delivered. Notification payloads must remain free of secrets and personal request data.

Do not modify session rows manually. Do not disclose database IDs, token hashes, raw user agents, network addresses, or provider payloads in support tickets.
