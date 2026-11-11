import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  token: "encrypted-google-enrollment",
  pending: vi.fn(), consume: vi.fn(), docs: vi.fn(), pendingLegal: vi.fn(),
  register: vi.fn(), authenticate: vi.fn(), issue: vi.fn(), rateLimit: vi.fn(),
  sameOrigin: vi.fn(), clientIp: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: mocks.token }) }),
}));
vi.mock("../apps/web/auth/google-enrollment", () => ({
  GOOGLE_ENROLLMENT_COOKIE: "bke_google_enrollment",
  readPendingGoogleEnrollment: mocks.pending,
  consumePendingGoogleEnrollment: mocks.consume,
}));
vi.mock("../apps/web/legal/service", () => ({
  registrationLegalDocuments: mocks.docs,
  pendingReacceptance: mocks.pendingLegal,
}));
vi.mock("../apps/web/auth/google-registration", () => ({
  registerGoogleCustomer: mocks.register,
}));
vi.mock("../apps/web/auth/runtime", () => ({
  getIdentityWebApplication: async () => ({ get: () => ({ authenticate: mocks.authenticate }) }),
}));
vi.mock("../apps/web/auth/session", () => ({
  issueGoogleIdentitySession: mocks.issue,
}));
vi.mock("../apps/web/http/request", () => ({
  assertSameOrigin: mocks.sameOrigin,
  clientIp: mocks.clientIp,
}));
vi.mock("../apps/web/http/rate-limit", () => ({ rateLimit: mocks.rateLimit }));

import { POST } from "../app/api/auth/google/finish-registration/route";

const termsId = "ckabcdefghijklmnopqrstuv";
const privacyId = "ckabcdefghijklmnopqrstuw";
const body = (ids = [termsId, privacyId]) => new Request(
  "https://staging.example.test/api/auth/google/finish-registration",
  { method: "POST", headers: { origin: "https://staging.example.test", "content-type": "application/json" },
    body: JSON.stringify({ legalVersionIds: ids }) },
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending.mockResolvedValue({
    jti: "4c3cda67-5a21-4fba-a646-443c9b635bcb",
    subject: "verified-google-subject",
    email: "new@gmail.com",
    emailVerified: true,
    hostedDomain: null,
    name: "New Customer",
    authenticatedAt: null,
    returnTo: "/dashboard",
  });
  mocks.docs.mockResolvedValue([
    { currentPublishedVersionId: termsId, currentPublishedVersion: { status: "PUBLISHED" } },
    { currentPublishedVersionId: privacyId, currentPublishedVersion: { status: "PUBLISHED" } },
  ]);
  mocks.consume.mockResolvedValue(true);
  mocks.pendingLegal.mockResolvedValue([]);
  mocks.register.mockResolvedValue({ user: { id: "user-new" } });
  mocks.authenticate.mockResolvedValue({ status: "PRIMARY_AUTHENTICATED", principal: { id: "user-new", role: "CUSTOMER" } });
  mocks.issue.mockResolvedValue({ id: "session-new" });
  mocks.rateLimit.mockResolvedValue({ allowed: true });
  mocks.clientIp.mockReturnValue("127.0.0.1");
});

describe("post-OIDC unified Google customer enrollment", () => {
  it("requires legal acceptance before creating a customer or issuing a session", async () => {
    const response = await POST(body([termsId, termsId]));
    expect(response.status).toBe(409);
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("uses only verified encrypted enrollment identity, not client submitted subject/email", async () => {
    const response = await POST(body());
    expect(response.status).toBe(200);
    expect((await response.json()).redirectTo).toBe("/dashboard");
    expect(response.cookies.get("bke_google_enrollment")?.value).toBe("");
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      subject: "verified-google-subject", email: "new@gmail.com",
      legalVersionIds: [termsId, privacyId],
    }));
    expect(mocks.issue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-new", subject: "verified-google-subject", authenticatedAt: null,
    }));
  });
  it("returns newly registered buyers to their selected product after mandatory consent", async () => {
    mocks.pending.mockResolvedValueOnce({
      jti: "4c3cda67-5a21-4fba-a646-443c9b635bcb",
      subject: "verified-google-subject",
      email: "new@gmail.com",
      emailVerified: true,
      hostedDomain: null,
      name: "New Customer",
      authenticatedAt: null,
      returnTo: "/products/render-dock",
    });
    const response = await POST(body());
    expect(response.status).toBe(200);
    expect((await response.json()).redirectTo).toBe("/products/render-dock");
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.issue).toHaveBeenCalledOnce();
  });
  it("rejects reused one-time enrollments before creating accounts", async () => {
    mocks.consume.mockResolvedValue(false);
    const response = await POST(body());
    expect(response.status).toBe(403);
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("fails closed on conflicting identity and never issues a session", async () => {
    mocks.register.mockRejectedValue(new Error("ACCOUNT_EXISTS"));
    const response = await POST(body());
    expect(response.status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("never accepts a non-CUSTOMER principal from a new enrollment", async () => {
    mocks.authenticate.mockResolvedValue({ status: "PRIMARY_AUTHENTICATED", principal: { id: "user-new", role: "ADMIN" } });
    const response = await POST(body());
    expect(response.status).toBe(403);
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("rejects unreadable or expired encrypted cookies before consuming them", async () => {
    mocks.pending.mockRejectedValue(new Error("INVALID_JWT"));
    const response = await POST(body());
    expect(response.status).toBe(403);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
  it("rate-limits repeated enrollment POSTs", async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false });
    expect((await POST(body())).status).toBe(429);
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
