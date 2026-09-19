import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGoogleRegistrationIntent,
  readGoogleRegistrationIntent,
} from "@/apps/web/auth/google-registration-intent";
import type { VerifiedGoogleOidcIdentity } from "@/apps/web/auth/google-oidc";

const secret = "google-registration-transaction-secret-" + "g".repeat(48);
const now = new Date("2026-09-19T01:55:00.000Z");

function identity(
  overrides: Partial<VerifiedGoogleOidcIdentity> = {},
): VerifiedGoogleOidcIdentity {
  return {
    provider: "GOOGLE",
    subject: "google-subject-123",
    email: "Buyer@Example.com",
    emailVerified: true,
    name: "Buyer",
    authenticatedAt: new Date(now.getTime() - 30_000),
    ...overrides,
  };
}

describe("V3 Google registration intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("seals only a cryptographically verified Google identity for legal onboarding", async () => {
    const created = await createGoogleRegistrationIntent({
      identity: identity(),
      transactionSecret: secret,
      returnTo: "/dashboard/products?tab=mine",
    });

    expect(created.token).not.toContain("buyer@example.com");
    expect(created.token).not.toContain("google-subject-123");

    const decoded = await readGoogleRegistrationIntent(created.token, secret);
    expect(decoded).toMatchObject({
      id: created.intent.id,
      provider: "GOOGLE",
      subject: "google-subject-123",
      email: "buyer@example.com",
      emailVerified: true,
      name: "Buyer",
      returnTo: "/dashboard/products?tab=mine",
    });
    expect(decoded.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("rejects an unverified Google email before an onboarding intent can exist", async () => {
    await expect(createGoogleRegistrationIntent({
      identity: identity({ emailVerified: false }),
      transactionSecret: secret,
    })).rejects.toThrow("GOOGLE_REGISTRATION_IDENTITY_INVALID");
  });

  it("rejects stale or future-dated provider assertions", async () => {
    await expect(createGoogleRegistrationIntent({
      identity: identity({ authenticatedAt: new Date(now.getTime() - 16 * 60_000) }),
      transactionSecret: secret,
    })).rejects.toThrow("GOOGLE_REGISTRATION_ASSERTION_STALE");

    await expect(createGoogleRegistrationIntent({
      identity: identity({ authenticatedAt: new Date(now.getTime() + 2 * 60_000) }),
      transactionSecret: secret,
    })).rejects.toThrow("GOOGLE_REGISTRATION_ASSERTION_STALE");
  });

  it("rejects tampered and expired registration intents", async () => {
    const created = await createGoogleRegistrationIntent({
      identity: identity(),
      transactionSecret: secret,
    });

    await expect(
      readGoogleRegistrationIntent(created.token + "tamper", secret),
    ).rejects.toThrow();

    vi.setSystemTime(new Date(now.getTime() + 16 * 60_000));
    await expect(
      readGoogleRegistrationIntent(created.token, secret),
    ).rejects.toThrow();
  });

  it("never preserves an external return target", async () => {
    const created = await createGoogleRegistrationIntent({
      identity: identity(),
      transactionSecret: secret,
      returnTo: "https://evil.example/steal",
    });
    const decoded = await readGoogleRegistrationIntent(created.token, secret);
    expect(decoded.returnTo).toBe("/dashboard");
  });
});
