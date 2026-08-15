import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const upsert = vi.fn();
const transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ siteContent: { upsert }, auditLog: { create: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { siteContent: { findMany, upsert }, $transaction: transaction } }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

describe("site content", () => {
  it("returns typed defaults for missing keys", async () => {
    findMany.mockResolvedValueOnce([]);
    const { getSiteContent } = await import("@/lib/site-content");
    const { DEFAULT_SITE_CONTENT } = await import("@/lib/site-content");
    await expect(getSiteContent()).resolves.toEqual(DEFAULT_SITE_CONTENT);
  });

  it("rejects unknown keys and oversized values before persistence", async () => {
    const { saveSiteContent } = await import("@/lib/site-content");
    await expect(saveSiteContent("actor", { nope: "bad" } as never)).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("validates and persists typed content", async () => {
    const { saveSiteContent } = await import("@/lib/site-content");
    await saveSiteContent("actor", { siteName: "Acme", heroHeadline: "Hello", heroDescription: "About", supportEmail: "help@acme.test", footerText: "About" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledTimes(14);
  });

  it("rejects unsafe CTA destinations before persistence", async () => {
    transaction.mockClear();
    const { saveSiteContent } = await import("@/lib/site-content");
    await expect(saveSiteContent("actor", { heroPrimaryHref: "javascript:alert(1)" })).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
