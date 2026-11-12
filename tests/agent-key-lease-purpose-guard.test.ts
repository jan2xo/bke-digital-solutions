import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));
vi.mock("@/apps/web/agent-sessions/device-authorization", () => ({
  authenticateAgentAccessToken: mocks.authenticate,
}));

import { verifyAgentKeyChallenge } from
  "@/apps/web/agent-sessions/agent-key-proof-authority";

const now = new Date("2026-11-12T15:00:00.000Z");
const input = {
  accessToken: "bound-agent-bearer", pepper: "strong-pepper",
  challengeId: "enrollment-challenge-not-lease",
  messageBase64url: "Y2hhbGxlbmdl",
  signatureBase64url: "c2lnbmF0dXJl",
  expectedPurpose: "LEASE" as const,
};

function transaction(purpose: "LEASE" | "ENROLL") {
  const query = vi.fn().mockResolvedValue([{
    id: "challenge-1", registrationId: "registration-1",
    sessionId: "authenticated-session", accountId: "authenticated-account",
    userId: "authenticated-user", deviceId: "authenticated-device",
    purpose, productId: purpose === "LEASE" ? "render-dock" : null,
    action: purpose === "LEASE" ? "OPEN" : null,
    createdAt: new Date(now.getTime() - 1000),
    expiresAt: new Date(now.getTime() + 1000),
    consumedAt: null, validUntil: new Date(now.getTime() + 100_000),
    status: purpose === "LEASE" ? "ACTIVE" : "PENDING",
  }]);
  const execute = vi.fn();
  const create = vi.fn();
  const tx = {
    $queryRaw: query, $executeRaw: execute, auditLog: { create },
  } as unknown as Prisma.TransactionClient;
  return { tx, query, execute, create };
}

describe("Agent lease purpose guard BEFORE nonce consumption", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      status: "authenticated",
      sessionId: "authenticated-session",
      accountId: "authenticated-account",
      userId: "authenticated-user",
      deviceId: "authenticated-device",
    });
  });

  it("rejects an ENROLL challenge without burning nonce or activating a registration", async () => {
    const { tx, query, execute, create } = transaction("ENROLL");
    expect(await verifyAgentKeyChallenge(tx, input, now))
      .toEqual({ status: "denied", reason: "INVALID_CHALLENGE" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("requires authenticated Agent session before reading any challenge", async () => {
    mocks.authenticate.mockResolvedValueOnce({ status: "invalid_token" });
    const { tx, query, execute } = transaction("ENROLL");
    expect(await verifyAgentKeyChallenge(tx, input, now))
      .toEqual({ status: "denied", reason: "INVALID_TOKEN" });
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("asserts the lock-scoped purpose test structurally precedes the nonce UPDATE", () => {
    const source = readFileSync("apps/web/agent-sessions/agent-key-proof-authority.ts", "utf8");
    const verifier = source.slice(source.indexOf("export async function verifyAgentKeyChallenge("));
    const purpose = verifier.indexOf('input.expectedPurpose === "LEASE" && row.purpose !== "LEASE"');
    const nonceBurn = verifier.indexOf('UPDATE "AgentLeaseKeyChallenge" SET "consumedAt"');
    expect(purpose).toBeGreaterThan(-1);
    expect(nonceBurn).toBeGreaterThan(purpose);
    expect(verifier.slice(0, nonceBurn)).toContain("FOR UPDATE OF c, r");
  });
});
