# Session management

Sessions are database-backed and cookies contain only a random token whose hash is stored in PostgreSQL. Cookies are HttpOnly, same-site Lax, path `/`, and Secure with a `__Host-` name in production.

The current policy is a 14-day absolute lifetime and 60-minute idle timeout. Activity is persisted at most once every five minutes. Suspended users and expired or idle sessions fail closed. Password changes, MFA enrollment, MFA disablement, recovery-code regeneration, and bootstrap password rotation revoke prior sessions. Administrators require both an enabled MFA method and an MFA-verified session on every admin route.

The Phase 5.1 security page shows an administrator's own active-session summary. Other-session targeted revocation and delegated security administration remain Phase 5.3 work.
