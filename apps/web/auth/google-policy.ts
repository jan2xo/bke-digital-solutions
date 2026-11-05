export const GOOGLE_FRESH_AUTH_WINDOW_MINUTES = 15;

/** A contact fact, never an account-binding or administrator-role decision. */
export function authoritativeGoogleContact(input: {
  email: string | null;
  emailVerified: boolean;
  hostedDomain?: string | null;
}): boolean {
  if (!input.emailVerified || !input.email || input.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) return false;
  return input.email.toLowerCase().endsWith("@gmail.com") ||
    (typeof input.hostedDomain === "string" && input.hostedDomain.trim().length > 0);
}

/** Call only after ID-token signature, issuer, audience, expiry and nonce validation. */
export function googleAuthenticationTime(
  claim: unknown,
  issuedAt: number,
  now = Date.now(),
): Date | null {
  if (claim === undefined) return null;
  if (typeof claim !== "number" || !Number.isSafeInteger(claim) || claim <= 0 ||
      claim > Math.floor(now / 1000) || claim > issuedAt) {
    throw new Error("INVALID_GOOGLE_AUTH_TIME");
  }
  return new Date(claim * 1000);
}

export function hasFreshGoogleAuthentication(
  authenticatedAt: Date | null,
  maxAgeMinutes = GOOGLE_FRESH_AUTH_WINDOW_MINUTES,
  now = new Date(),
): boolean {
  return Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 &&
    authenticatedAt !== null && Number.isFinite(authenticatedAt.getTime()) &&
    authenticatedAt <= now &&
    authenticatedAt >= new Date(now.getTime() - maxAgeMinutes * 60_000);
}
