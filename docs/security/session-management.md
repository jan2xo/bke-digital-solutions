# Session management

Sessions are database-backed and cookies contain only a random token whose hash is stored in PostgreSQL. Cookies are HttpOnly, same-site Lax, path `/`, and Secure with a `__Host-` name in production.

The current policy is a 14-day absolute lifetime and 60-minute idle timeout. Activity is persisted at most once every five minutes. Suspended users and expired, idle, or revoked sessions fail closed on the next request. Revocation is retained with a timestamp and bounded reason rather than deleting the authentication record. Password changes, MFA enrollment, MFA disablement, recovery-code regeneration, and bootstrap password rotation revoke prior sessions. Administrators require both an enabled MFA method and an MFA-verified session on every admin route.

The Phase 5.3 security dashboard shows only the signed-in administrator's sessions using normalized browser/device and keyed network hints. It never returns token hashes, cookie values, raw user-agent strings, full IP addresses, or precise location. Revoking one session, all other sessions, or every session requires same-origin POST, administrator MFA, recent authentication, a distributed rate limit, and an ownership-constrained transaction. Replaying a revocation is safe. Revoking the current session clears its cookie.

Revoked session metadata is retained for 90 days for incident review, then may be purged by an approved retention job. Security events are retained for at least 365 days unless the legal/privacy retention policy requires a different approved period. No automated purge job is enabled in this phase.
