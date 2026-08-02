import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { SESSION_SECRET: "integration-session-secret-value", DATABASE_URL: process.env.DATABASE_URL } }));

describe.sequential("administrator session administration", () => {
  let db: typeof import("@/lib/db")["db"];
  let userId = "";
  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
    userId = (await db.user.create({ data: { email: `session-admin-${Date.now()}@bke.test`, role: "ADMIN", emailVerified: new Date() } })).id;
  });
  afterAll(async () => {
    await db.emailOutbox.deleteMany({ where: { recipient: { startsWith: "session-admin-" } } });
    await db.securityEvent.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });
  const create = async () => db.session.create({ data: { userId, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000), absoluteExpiresAt: new Date(Date.now() + 86_400_000), lastSeenAt: new Date(), userAgentSummary: "Safari on macOS", networkHint: "Network 12345678" } });

  it("revokes one owned session idempotently and not another administrator's session", async () => {
    const { revokeAdministratorSessions } = await import("@/lib/security/session-administration");
    const current = await create(); const target = await create();
    await revokeAdministratorSessions({ userId, currentSessionId: current.id, action: "ONE", targetSessionId: target.id });
    await revokeAdministratorSessions({ userId, currentSessionId: current.id, action: "ONE", targetSessionId: target.id });
    expect((await db.session.findUniqueOrThrow({ where: { id: target.id } })).revokedAt).not.toBeNull();
    const other = await db.user.create({ data: { email: `other-admin-${Date.now()}@bke.test`, role: "ADMIN" } });
    const otherSession = await db.session.create({ data: { userId: other.id, tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() + 86_400_000), absoluteExpiresAt: new Date(Date.now() + 86_400_000) } });
    await expect(revokeAdministratorSessions({ userId, currentSessionId: current.id, action: "ONE", targetSessionId: otherSession.id })).rejects.toThrow("SESSION_NOT_OWNED");
    await db.user.delete({ where: { id: other.id } });
  });

  it("revokes all other sessions while preserving the current session", async () => {
    const { revokeAdministratorSessions } = await import("@/lib/security/session-administration");
    const current = await create(); const other = await create();
    await revokeAdministratorSessions({ userId, currentSessionId: current.id, action: "OTHERS" });
    expect((await db.session.findUniqueOrThrow({ where: { id: current.id } })).revokedAt).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt).not.toBeNull();
  });
});
