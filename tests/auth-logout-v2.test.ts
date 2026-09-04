import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
  applicationGet: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    delete: mocks.cookieDelete,
    set: mocks.cookieSet,
  })),
}));

vi.mock("../v2/apps/web/runtime", () => ({
  getV2WebApplication: vi.fn(async () => ({ get: mocks.applicationGet })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "test";
  mocks.cookieGet.mockReturnValue({ value: "raw-token" });
  mocks.applicationGet.mockReturnValue({ terminate: mocks.terminate });
  mocks.terminate.mockResolvedValue({ status: "TERMINATED" });
});

describe("V2 logout session termination", () => {
  it("clears the cookie without touching persistence when there is no session token", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    const { terminateCurrentIdentitySession } = await import("../v2/apps/web/auth/session");

    await terminateCurrentIdentitySession();

    expect(mocks.applicationGet).not.toHaveBeenCalled();
    expect(mocks.terminate).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenCalledWith("bke_session");
  });

  it("terminates through Identity before clearing the session cookie", async () => {
    const { terminateCurrentIdentitySession } = await import("../v2/apps/web/auth/session");

    await terminateCurrentIdentitySession();

    expect(mocks.applicationGet).toHaveBeenCalledWith("bke.identity.session-termination.v1");
    expect(mocks.terminate).toHaveBeenCalledWith("raw-token");
    expect(mocks.terminate.mock.invocationCallOrder[0]).toBeLessThan(mocks.cookieDelete.mock.invocationCallOrder[0]);
    expect(mocks.cookieDelete).toHaveBeenCalledWith("bke_session");
  });

  it.each(["TOKEN_PROVIDER_UNAVAILABLE", "PERSISTENCE_UNAVAILABLE"] as const)(
    "fails closed on %s without clearing the cookie",
    async (code) => {
      mocks.terminate.mockResolvedValue({ status: "FAILED", code });
      const { terminateCurrentIdentitySession } = await import("../v2/apps/web/auth/session");

      await expect(terminateCurrentIdentitySession()).rejects.toMatchObject({ code, status: 503 });
      expect(mocks.cookieDelete).not.toHaveBeenCalled();
    },
  );

  it("keeps the production logout route on V2-owned host seams", () => {
    const source = readFileSync("app/api/auth/logout/route.ts", "utf8");
    expect(source).toContain("terminateCurrentIdentitySession");
    expect(source).toContain("@/v2/apps/web/auth/session");
    expect(source).toContain("@/v2/apps/web/http/request");
    expect(source).toContain("@/v2/apps/web/http/api-error");
    expect(source).not.toMatch(/from\s+["']@\/lib\/auth["']/);
    expect(source).not.toContain("@/lib/security/request");
  });
});
