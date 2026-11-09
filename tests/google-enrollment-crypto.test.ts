import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ consume: vi.fn() }));
vi.mock("../apps/web/http/rate-limit", () => ({ consumeOneTimeKey: mocks.consume }));
import {
  createPendingGoogleEnrollment,
  readPendingGoogleEnrollment,
  consumePendingGoogleEnrollment,
} from "../apps/web/auth/google-enrollment";

beforeEach(() => {
  process.env.SESSION_SECRET = "enrollment-crypto-test-secret-must-be-at-least-32-characters";
  vi.clearAllMocks();
});

describe("Google enrollment encrypted handoff", () => {
  it("round-trips only verified authoritative Google claims with purpose-bound encryption", async () => {
    const token = await createPendingGoogleEnrollment({
      subject: "immutable-google-subject",
      email: "verified@gmail.com",
      emailVerified: true, hostedDomain: null, name: "Customer",
      authenticatedAt: new Date("2026-11-09T00:00:00.000Z"),
      returnTo: "/dashboard",
    });
    expect(token).not.toContain("verified@gmail.com");
    const verified = await readPendingGoogleEnrollment(token);
    expect(verified.subject).toBe("immutable-google-subject");
    expect(verified.email).toBe("verified@gmail.com");
    expect(verified.returnTo).toBe("/dashboard");
    expect(verified.authenticatedAt?.toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(verified.jti).toBeTruthy();
  });
  it("rejects tampered enrollment tokens and unverified external contacts", async () => {
    const token = await createPendingGoogleEnrollment({
      subject: "subject", email: "new@gmail.com", emailVerified: true,
      hostedDomain: null, name: null, authenticatedAt: null, returnTo: "https://evil.test/",
    });
    await expect(readPendingGoogleEnrollment(token.slice(0, -2) + "xx")).rejects.toThrow();
    expect((await readPendingGoogleEnrollment(token)).returnTo).toBe("/dashboard");
    await expect(createPendingGoogleEnrollment({
      subject: "subject", email: "external@example.test", emailVerified: true,
      hostedDomain: null, name: null, authenticatedAt: null, returnTo: "/",
    })).rejects.toThrow("CONTACT_EMAIL_NOT_AUTHORITATIVE");
  });
  it("uses one atomic backend replay check per enrolled token", async () => {
    mocks.consume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const token = await createPendingGoogleEnrollment({
      subject: "subject", email: "new@gmail.com", emailVerified: true,
      hostedDomain: null, name: null, authenticatedAt: null, returnTo: "/dashboard",
    });
    const pending = await readPendingGoogleEnrollment(token);
    expect(await consumePendingGoogleEnrollment(pending.jti)).toBe(true);
    expect(await consumePendingGoogleEnrollment(pending.jti)).toBe(false);
    expect(mocks.consume).toHaveBeenCalledWith(
      expect.stringContaining("google-customer-enrollment:"), 600,
    );
  });
});
