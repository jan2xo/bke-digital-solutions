import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { db } from "../platform/host/db";
import { describe, expect, it } from "vitest";

describe("retired native password reset", () => {
  it("retires native reset requests with a generic Google handoff response", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/native/password-reset/request/route"
    );
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "GOOGLE_BROWSER_HANDOFF_REQUIRED",
    });
  });

  it("returns the same retired response for known and unknown account emails", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/native/password-reset/request/route"
    );
    const invoke: (request: Request) => Promise<Response> = POST;
    const knownEmail = `known-reset-target-${randomUUID()}@example.test`;
    const unknownEmail = `unknown-reset-target-${randomUUID()}@example.test`;
    const knownUser = await db.user.create({
      data: { email: knownEmail },
      select: { id: true },
    });

    try {
      const [unknownResponse, knownResponse] = await Promise.all([
        invoke(new Request("https://jl-bke.com/api/agent-sessions/native/password-reset/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: unknownEmail }),
        })),
        invoke(new Request("https://jl-bke.com/api/agent-sessions/native/password-reset/request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: knownEmail, password: "must-not-be-reflected" }),
        })),
      ]);
      expect(unknownResponse.status).toBe(knownResponse.status);
      expect(unknownResponse.headers.get("cache-control")).toBe("no-store");
      expect(knownResponse.headers.get("cache-control")).toBe("no-store");
      expect(unknownResponse.headers.get("set-cookie")).toBeNull();
      expect(knownResponse.headers.get("set-cookie")).toBeNull();
      const [unknownBody, knownBody] = await Promise.all([
        unknownResponse.json(),
        knownResponse.json(),
      ]);
      expect(unknownBody).toEqual(knownBody);
      expect(JSON.stringify(unknownBody)).not.toMatch(/email|token|password/i);
    } finally {
      await db.user.delete({ where: { id: knownUser.id } });
    }
  });

  it("continues to invalidate old Agent sessions after a credential epoch change", () => {
    const authority = readFileSync(
      "apps/web/agent-sessions/device-authorization.ts",
      "utf8",
    );

    expect(authority).toContain("createdAt: Date");
    expect(authority).toContain("passwordCredential.findUnique");
    expect(authority).toContain("credential.changedAt > session.createdAt");
    expect(
      authority.match(/agentSessionPredatesPasswordCredential\(tx, session\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(authority).toContain("await revokeAgentSessionFamily(tx, session.id, now)");
  });

  it("retires native reset completion without issuing a session or reflecting reset material", async () => {
    const { POST } = await import(
      "../app/api/agent-sessions/native/password-reset/complete/route"
    );
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toMatch(/token|password|session/i);
  });

  it("retires browser password-reset routes with the same no-store policy", async () => {
    const request = await import("../app/api/auth/password-reset/request/route");
    const consume = await import("../app/api/auth/password-reset/consume/route");

    for (const handler of [request.POST, consume.POST]) {
      const response = await handler();
      expect(response.status).toBe(410);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
});
