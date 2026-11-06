import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentitySessionIssuanceCapability } from "@bke/identity/contracts/session.contract";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID } from "@bke/identity/contracts/session.contract";
import { IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID, type IdentityGoogleAuthenticationCapability } from "@bke/identity/contracts/google-authentication.contract";

const state = vi.hoisted(() => ({ token: "", capabilities: new Map<string, unknown>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined, set: vi.fn(), delete: vi.fn() }),
}));
vi.mock("../apps/web/auth/runtime", () => ({
  getIdentityWebApplication: async () => ({ get: (id: string) => state.capabilities.get(id) }),
}));
import { db } from "../platform/host/db";
import { createIdentityModule } from "../modules/identity/module";
import { currentIdentitySession, requireAdmin, requireRecentAdmin, requireRecentAdminSession, requireRecentUser, recordGoogleSessionFreshness } from "../apps/web/auth/session";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
let userId: string;
let subject: string;
let sessionId: string;
suite("Google-only browser session and protected-action PostgreSQL policy", () => {
  beforeEach(async () => {
    const identityModule = createIdentityModule({ connectionString: process.env.DATABASE_URL!, sessionSecret: "test-google-session-policy-secret-48-characters-long" });
    const capabilities = await identityModule.start({ has: () => false, get: () => { throw new Error("No dependency expected"); } });
    state.capabilities = new Map(capabilities.map(({ id, value }) => [id, value]));
    const suffix = randomUUID();
    subject = `subject-${suffix}`;
    const user = await db.user.create({ data: {
      email: `google-policy-${suffix}@gmail.com`, emailVerified: new Date(),
      googleIdentity: { create: { subject } },
    } });
    userId = user.id;
    const issuance = state.capabilities.get(IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID) as IdentitySessionIssuanceCapability;
    const result = await issuance.issue({ userId, authenticationMethod: "GOOGLE_OIDC" });
    if (result.status !== "ISSUED") throw new Error(result.code);
    state.token = result.token;
    sessionId = result.session.id;
  });
  afterEach(async () => {
    state.token = "";
    await db.session.deleteMany({ where: { userId } });
    await db.googleIdentity.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  });
  afterAll(async () => { await db.$disconnect(); });

  it("accepts returning Google sessions but cannot promote a customer to administrator", async () => {
    expect((await currentIdentitySession())?.principal.id).toBe(userId);
    await expect(requireAdmin()).rejects.toThrow("FORBIDDEN");
    await expect(requireRecentAdmin()).rejects.toThrow("FORBIDDEN");
    await expect(requireRecentAdminSession()).rejects.toThrow("FORBIDDEN");
    const authentication = state.capabilities.get(IDENTITY_GOOGLE_AUTHENTICATION_CAPABILITY_ID) as IdentityGoogleAuthenticationCapability;
    expect(await authentication.authenticate({ subject })).toMatchObject({ status: "PRIMARY_AUTHENTICATED", route: "SESSION", principal: { id: userId, role: "CUSTOMER" } });
  });
  it("permits administrator operations without fresh Google auth_time", async () => {
    await db.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
    const before = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(before.authenticationMethod).toBe("GOOGLE_OIDC");
    expect(before.recentAuthenticatedAt).toBeNull();
    expect((await requireAdmin()).id).toBe(userId);
    expect((await requireRecentAdmin()).id).toBe(userId);
    expect((await requireRecentAdminSession()).user.id).toBe(userId);
    await db.session.update({
      where: { id: sessionId },
      data: { assuranceLevel: "BASIC", recentAuthenticatedAt: new Date(Date.now() - 24 * 60 * 60_000) },
    });
    expect((await requireRecentAdmin()).id).toBe(userId);
    expect((await requireRecentAdminSession()).user.id).toBe(userId);
  });
  it("preserves customer-sensitive signed Google freshness checks", async () => {
    await expect(requireRecentUser()).rejects.toThrow("RECENT_AUTH_REQUIRED");
    const authenticatedAt = new Date(Date.now() - 60_000);
    await recordGoogleSessionFreshness({ sessionId, userId, subject, authenticatedAt });
    expect((await requireRecentUser()).id).toBe(userId);
    const stored = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.mfaVerifiedAt).toBeNull();
    expect(stored.recentAuthenticatedAt).toEqual(authenticatedAt);
  });
  it("cannot turn a missing, stale or future proof into protected access", async () => {
    for (const authenticatedAt of [null, new Date(Date.now() - 960_000), new Date(Date.now() + 60_000)]) {
      await expect(recordGoogleSessionFreshness({ sessionId, userId, subject, authenticatedAt })).rejects.toThrow("RECENT_AUTH_REQUIRED");
    }
    expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).recentAuthenticatedAt).toBeNull();
  });
  it("binds freshness to the exact Google subject, principal, and non-revoked session", async () => {
    const authenticatedAt = new Date(Date.now() - 60_000);
    await expect(recordGoogleSessionFreshness({ sessionId, userId, subject: "attacker-subject", authenticatedAt })).rejects.toThrow("UNAUTHENTICATED");
    await expect(recordGoogleSessionFreshness({ sessionId, userId: "attacker-user", subject, authenticatedAt })).rejects.toThrow("UNAUTHENTICATED");
    await db.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await expect(recordGoogleSessionFreshness({ sessionId, userId, subject, authenticatedAt })).rejects.toThrow("UNAUTHENTICATED");
    expect(await currentIdentitySession()).toBeNull();
    await expect(requireRecentAdmin()).rejects.toThrow("UNAUTHENTICATED");
  });
  it("blocks suspended principals and password-family sessions even if their bearer token is valid", async () => {
    await db.user.update({ where: { id: userId }, data: { lifecycleState: "SUSPENDED", suspendedAt: new Date() } });
    expect(await currentIdentitySession()).toBeNull();
    await expect(requireRecentAdmin()).rejects.toThrow("UNAUTHENTICATED");
    await db.user.update({ where: { id: userId }, data: { lifecycleState: "ACTIVE", suspendedAt: null } });
    const issuance = state.capabilities.get(IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID) as IdentitySessionIssuanceCapability;
    const result = await issuance.issue({ userId, authenticationMethod: "PASSWORD" });
    if (result.status !== "ISSUED") throw new Error(result.code);
    state.token = result.token;
    expect(await currentIdentitySession()).toBeNull();
    await expect(requireRecentAdmin()).rejects.toThrow("UNAUTHENTICATED");
  });
});
