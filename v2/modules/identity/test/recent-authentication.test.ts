import { describe, expect, it, vi } from "vitest";
import type { IdentityEmailMfaProofProvider } from "../logic/email-mfa-proof-provider";
import type { IdentityPasswordVerifier } from "../logic/password-verifier";
import { createIdentityRecentAuthenticationCapability } from "../logic/recent-authentication";
import type { IdentityRecentAuthenticationRepository } from "../logic/recent-authentication-repository";

const now = new Date("2026-08-31T09:00:00.000Z");

function passwordVerifier(valid = true): IdentityPasswordVerifier {
  return { verify: vi.fn(async () => valid) };
}

function proofProvider(): IdentityEmailMfaProofProvider {
  return {
    hashChallengeToken: vi.fn((token) => `hashed:${token}`),
    verifyEmailCode: vi.fn((hash, code) => hash === `code:${code}`),
    hashRecoveryCode: vi.fn((code) => `recovery:${code}`),
  };
}

function repository(
  role: "CUSTOMER" | "ADMIN" = "CUSTOMER",
): IdentityRecentAuthenticationRepository {
  return {
    findContext: vi.fn(async (sessionId, userId) => ({
      sessionId,
      userId,
      userRole: role,
      passwordHash: "argon-hash",
      mfaVerifiedAt: role === "ADMIN" ? now : null,
      administratorMfaEnabled: role === "ADMIN",
    })),
    findChallenge: vi.fn(async (userId) => ({
      id: "challenge-1",
      userId,
      purpose: "RECENT_AUTH" as const,
      codeHash: "code:123456",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
      attemptCount: 0,
    })),
    findUnusedRecoveryCode: vi.fn(async () => null),
    incrementChallengeAttempt: vi.fn(async () => undefined),
    upgradeCustomerSession: vi.fn(async () => "UPDATED" as const),
    completeAdminRecentAuthentication: vi.fn(async () => "UPDATED" as const),
  };
}

describe("Identity recent authentication", () => {
  it("upgrades a customer session using password only", async () => {
    const repo = repository("CUSTOMER");
    const capability = createIdentityRecentAuthenticationCapability(
      repo,
      passwordVerifier(),
      proofProvider(),
      () => now,
    );

    await expect(
      capability.authenticate({
        sessionId: "session-1",
        userId: "customer-1",
        password: "password",
      }),
    ).resolves.toEqual({
      status: "AUTHENTICATED",
      sessionId: "session-1",
      userId: "customer-1",
      recentAuthenticatedAt: now,
      authenticationMethod: "PASSWORD",
    });
    expect(repo.upgradeCustomerSession).toHaveBeenCalledWith(
      "session-1",
      "customer-1",
      now,
    );
    expect(repo.findChallenge).not.toHaveBeenCalled();
  });

  it("requires both password and MFA proof for administrators", async () => {
    const admin = createIdentityRecentAuthenticationCapability(
      repository("ADMIN"),
      passwordVerifier(),
      proofProvider(),
      () => now,
    );
    await expect(
      admin.authenticate({
        sessionId: "session-1",
        userId: "admin-1",
        password: "password",
      }),
    ).resolves.toEqual({ status: "INVALID", code: "MFA_PROOF_REQUIRED" });

    const badPassword = createIdentityRecentAuthenticationCapability(
      repository("ADMIN"),
      passwordVerifier(false),
      proofProvider(),
      () => now,
    );
    await expect(
      badPassword.authenticate({
        sessionId: "session-1",
        userId: "admin-1",
        password: "wrong",
        challengeToken: "token",
        code: "123456",
      }),
    ).resolves.toEqual({ status: "INVALID", code: "INVALID_CREDENTIALS" });
  });

  it("consumes valid administrator email proof through the atomic commit port", async () => {
    const repo = repository("ADMIN");
    const capability = createIdentityRecentAuthenticationCapability(
      repo,
      passwordVerifier(),
      proofProvider(),
      () => now,
    );

    await expect(
      capability.authenticate({
        sessionId: "session-1",
        userId: "admin-1",
        password: "password",
        challengeToken: "token",
        code: "123456",
      }),
    ).resolves.toEqual({
      status: "AUTHENTICATED",
      sessionId: "session-1",
      userId: "admin-1",
      recentAuthenticatedAt: now,
      authenticationMethod: "PASSWORD_EMAIL_OTP",
    });
    expect(repo.completeAdminRecentAuthentication).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "admin-1",
      challengeId: "challenge-1",
      recoveryCodeId: null,
      authenticatedAt: now,
    });
  });

  it("increments attempts for wrong admin MFA proof without upgrading the session", async () => {
    const repo = repository("ADMIN");
    const capability = createIdentityRecentAuthenticationCapability(
      repo,
      passwordVerifier(),
      proofProvider(),
      () => now,
    );

    await expect(
      capability.authenticate({
        sessionId: "session-1",
        userId: "admin-1",
        password: "password",
        challengeToken: "token",
        code: "000000",
      }),
    ).resolves.toEqual({ status: "INVALID", code: "INVALID_CODE" });
    expect(repo.incrementChallengeAttempt).toHaveBeenCalledWith("challenge-1");
    expect(repo.completeAdminRecentAuthentication).not.toHaveBeenCalled();
  });

  it("maps invalid sessions and persistence failures fail-closed", async () => {
    const missing = repository();
    missing.findContext = vi.fn(async () => null);
    const invalid = createIdentityRecentAuthenticationCapability(
      missing,
      passwordVerifier(),
      proofProvider(),
      () => now,
    );
    await expect(
      invalid.authenticate({
        sessionId: "session-1",
        userId: "customer-1",
        password: "password",
      }),
    ).resolves.toEqual({ status: "INVALID", code: "INVALID_SESSION" });

    const broken = repository();
    broken.findContext = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const failed = createIdentityRecentAuthenticationCapability(
      broken,
      passwordVerifier(),
      proofProvider(),
      () => now,
    );
    await expect(
      failed.authenticate({
        sessionId: "session-1",
        userId: "customer-1",
        password: "password",
      }),
    ).resolves.toEqual({ status: "FAILED", code: "PERSISTENCE_UNAVAILABLE" });
  });
});
