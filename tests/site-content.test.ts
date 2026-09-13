import { beforeEach, describe, expect, it, vi } from "vitest";

const poolQuery = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();
const connect = vi.fn();
const auditInTransaction = vi.fn();

vi.mock("@/v2/apps/web/persistence/postgres", () => ({
  getPostgresPool: () => ({ query: poolQuery, connect }),
}));
vi.mock("@/v2/apps/web/audit", () => ({ auditInTransaction }));

describe("site content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [] });
    clientQuery.mockResolvedValue({ rows: [] });
    connect.mockResolvedValue({ query: clientQuery, release });
    auditInTransaction.mockResolvedValue(undefined);
  });

  it("returns typed defaults for missing keys", async () => {
    const { getSiteContent, DEFAULT_SITE_CONTENT } = await import("@/v2/apps/web/site-content");
    await expect(getSiteContent()).resolves.toEqual(DEFAULT_SITE_CONTENT);
  });

  it("rejects unknown keys and oversized values before persistence", async () => {
    const { saveSiteContent } = await import("@/v2/apps/web/site-content");
    await expect(saveSiteContent("actor", { nope: "bad" } as never)).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it("validates and persists typed content atomically with audit", async () => {
    const { saveSiteContent } = await import("@/v2/apps/web/site-content");
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
    expect(writes).toHaveLength(14);
    expect(clientQuery.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(auditInTransaction).toHaveBeenCalledOnce();
    expect(clientQuery.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects unsafe CTA destinations before persistence", async () => {
    const { saveSiteContent } = await import("@/v2/apps/web/site-content");
    await expect(saveSiteContent("actor", { heroPrimaryHref: "javascript:alert(1)" })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
});
