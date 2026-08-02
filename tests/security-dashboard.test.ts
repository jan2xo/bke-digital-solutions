import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { SESSION_SECRET: "security-dashboard-test-secret-value", TRUST_PROXY_HOPS: 1 } }));

describe("security dashboard safety", () => {
  it("summarizes user agents without returning the raw value", async () => {
    const { summarizeUserAgent } = await import("@/lib/security/session-display");
    const raw = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit Safari/605.1.15 private-marker";
    expect(summarizeUserAgent(raw)).toBe("Safari on macOS");
    expect(summarizeUserAgent(raw)).not.toContain("private-marker");
  });

  it("allowlists security metadata and drops secret-shaped fields", async () => {
    const { sanitizeSecurityMetadata } = await import("@/lib/security/events");
    expect(sanitizeSecurityMetadata({ reason: "login", count: 2, token: "secret", email: "private@example.com" } as never)).toEqual({ reason: "login", count: 2 });
  });

  it("creates conservative signals without claiming compromise", async () => {
    const { deriveSecurityReviewSignals } = await import("@/lib/security/review-signals");
    const events = Array.from({ length: 3 }, () => ({ type: "MFA_CHALLENGE_FAILED" as const, severity: "MEDIUM" as const, createdAt: new Date() }));
    const signals = deriveSecurityReviewSignals(events);
    expect(signals[0]?.title).toBe("Repeated authentication failures");
    expect(JSON.stringify(signals).toLowerCase()).not.toContain("compromised");
  });
});
