import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const connect = vi.fn();
const auditInTransaction = vi.fn();

vi.mock("@/apps/web/persistence/postgres", () => ({
  getPostgresPool: () => ({ query: poolQuery, connect }),
}));
vi.mock("@/apps/web/audit", () => ({ auditInTransaction }));

describe("site content", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://site-content.test");
    vi.stubEnv("SUPPORT_EMAIL", "runtime-support@site-content.test");
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [] });
    clientQuery.mockResolvedValue({ rows: [] });
    connect.mockResolvedValue({ query: clientQuery, release });
    auditInTransaction.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns typed defaults for missing keys", async () => {
    const { getSiteContent, DEFAULT_SITE_CONTENT } = await import("@/apps/web/site-content");
    await expect(getSiteContent()).resolves.toEqual({
      ...DEFAULT_SITE_CONTENT,
      supportEmail: "runtime-support@site-content.test",
    });
  });

  it("preserves an explicit CMS support-email override over runtime configuration", async () => {
    poolQuery.mockResolvedValue({ rows: [{ key: "supportEmail", value: "cms-support@site-content.test" }] });
    const { getSiteContent } = await import("@/apps/web/site-content");
    await expect(getSiteContent()).resolves.toMatchObject({ supportEmail: "cms-support@site-content.test" });
  });

  it("rejects unknown keys and oversized values before persistence", async () => {
    const { saveSiteContent } = await import("@/apps/web/site-content");
    await expect(saveSiteContent("actor", { nope: "bad" } as never)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("validates and persists typed content atomically with audit", async () => {
    const { saveSiteContent } = await import("@/apps/web/site-content");
    await saveSiteContent("actor", {
      siteName: "Acme",
      heroHeadline: "Hello",
      heroDescription: "About",
      supportEmail: "help@acme.test",
      footerText: "About",
    });

    const writes = clientQuery.mock.calls.filter(([statement]) =>
      String(statement).includes('INSERT INTO "SiteContent"'),
    );
    expect(writes).toHaveLength(5);
    expect(writes.map(([, values]) => values[1])).toEqual([
      "siteName", "heroHeadline", "heroDescription", "supportEmail", "footerText",
    ]);
    expect(clientQuery.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(auditInTransaction).toHaveBeenCalledOnce();
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("partial saves only replace supplied CMS fields and reset restores the environment fallback", async () => {
    const { saveSiteContent, resetSiteContent, getSiteContent } = await import("@/apps/web/site-content");
    await saveSiteContent("actor", { siteName: "Updated" });
    const writes = clientQuery.mock.calls.filter(([statement]) =>
      String(statement).includes('INSERT INTO "SiteContent"'),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]?.[1]).toBe("siteName");
    expect(auditInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      metadata: { keys: ["siteName"] },
    }));

    clientQuery.mockClear();
    await resetSiteContent("actor");
    expect(clientQuery.mock.calls.some(([statement]) =>
      String(statement).includes('DELETE FROM "SiteContent"'),
    )).toBe(true);
    poolQuery.mockResolvedValue({ rows: [] });
    await expect(getSiteContent()).resolves.toMatchObject({
      siteName: "BKE Digital Solutions",
      supportEmail: "runtime-support@site-content.test",
    });
  });

  it("rejects unsafe CTA destinations before persistence", async () => {
    const { saveSiteContent } = await import("@/apps/web/site-content");
    await expect(saveSiteContent("actor", { heroPrimaryHref: "javascript:alert(1)" })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});
