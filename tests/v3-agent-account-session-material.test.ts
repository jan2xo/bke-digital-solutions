import { describe, expect, it } from "vitest";
import {
  decryptAgentTokenBundle,
  encryptAgentTokenBundle,
  generateAgentDeviceCode,
  generateAgentSessionToken,
  generateAgentUserCode,
  hashAgentAccessToken,
  hashAgentDeviceCode,
  hashAgentRefreshToken,
  hashAgentUserCode,
  normalizeAgentUserCode,
} from "@/apps/web/agent-sessions/material";

const pepper = "p".repeat(64);
const encryptionKey = "e".repeat(64);

describe("V3 Agent account-session material", () => {
  it("generates independent high-entropy device/session tokens", () => {
    const deviceA = generateAgentDeviceCode();
    const deviceB = generateAgentDeviceCode();
    const tokenA = generateAgentSessionToken();
    const tokenB = generateAgentSessionToken();
    expect(deviceA).not.toBe(deviceB);
    expect(tokenA).not.toBe(tokenB);
    expect(deviceA.length).toBeGreaterThanOrEqual(40);
    expect(tokenA.length).toBeGreaterThanOrEqual(60);
  });

  it("generates human-friendly user codes without ambiguous characters", () => {
    const code = generateAgentUserCode();
    expect(code).toMatch(/^BKE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeAgentUserCode(code.toLowerCase())).toBe(code);
  });

  it("domain-separates every token hash", () => {
    const value = "same-secret-value";
    const hashes = new Set([
      hashAgentDeviceCode(value, pepper),
      hashAgentUserCode(value, pepper),
      hashAgentAccessToken(value, pepper),
      hashAgentRefreshToken(value, pepper),
    ]);
    expect(hashes.size).toBe(4);
  });

  it("encrypts the temporary token handoff bundle and round-trips only with the correct key", () => {
    const bundle = {
      sessionId: "session-1",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      accessExpiresAt: "2026-09-19T04:00:00.000Z",
      refreshExpiresAt: "2026-10-19T04:00:00.000Z",
      userId: "user-1",
      email: "buyer@example.com",
      accountId: "account-1",
      accountType: "INDIVIDUAL" as const,
      accountDisplayName: "Buyer",
    };
    const encrypted = encryptAgentTokenBundle(bundle, encryptionKey);
    expect(encrypted).not.toContain("access-secret");
    expect(encrypted).not.toContain("refresh-secret");
    expect(decryptAgentTokenBundle(encrypted, encryptionKey)).toEqual(bundle);
    expect(() => decryptAgentTokenBundle(encrypted, "x".repeat(64))).toThrow();
  });
});
