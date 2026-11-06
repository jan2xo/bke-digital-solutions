import { describe, expect, it } from "vitest";
import { authoritativeGoogleContact, googleAuthenticationTime, hasFreshGoogleAuthentication } from "../apps/web/auth/google-policy";

describe("Google authentication evidence policy", () => {
  it("accepts Google-authoritative verified Gmail and Workspace contacts only", () => {
    expect(authoritativeGoogleContact({ email: "person@gmail.com", emailVerified: true })).toBe(true);
    expect(authoritativeGoogleContact({ email: "person@company.test", emailVerified: true, hostedDomain: "company.test" })).toBe(true);
    expect(authoritativeGoogleContact({ email: "person@company.test", emailVerified: true })).toBe(false);
    expect(authoritativeGoogleContact({ email: "person@gmail.com.attacker.test", emailVerified: true })).toBe(false);
    expect(authoritativeGoogleContact({ email: "person@gmail.com", emailVerified: false })).toBe(false);
    expect(authoritativeGoogleContact({ email: null, emailVerified: true })).toBe(false);
  });
  it("uses signed auth_time rather than manufacturing freshness from issuance", () => {
    const now = 1_800_000_000_000;
    const issued = now / 1000;
    expect(googleAuthenticationTime(undefined, issued, now)).toBeNull();
    expect(googleAuthenticationTime(issued - 600, issued, now)?.getTime()).toBe(now - 600_000);
    for (const invalid of [null, "1800000000", 0, -1, NaN, issued + 1, issued - 0.5]) {
      expect(() => googleAuthenticationTime(invalid, issued, now)).toThrow("INVALID_GOOGLE_AUTH_TIME");
    }
    expect(() => googleAuthenticationTime(issued, issued - 1, now)).toThrow("INVALID_GOOGLE_AUTH_TIME");
  });
  it("rejects missing, stale, invalid and future authentication times", () => {
    const now = new Date(1_800_000_000_000);
    expect(hasFreshGoogleAuthentication(new Date(now.getTime() - 60_000), 15, now)).toBe(true);
    expect(hasFreshGoogleAuthentication(new Date(now.getTime() - 900_001), 15, now)).toBe(false);
    expect(hasFreshGoogleAuthentication(new Date(now.getTime() + 1), 15, now)).toBe(false);
    expect(hasFreshGoogleAuthentication(new Date(NaN), 15, now)).toBe(false);
    expect(hasFreshGoogleAuthentication(null, 15, now)).toBe(false);
  });
});
