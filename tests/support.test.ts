import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), redact: (value: unknown) => value }));
vi.mock("@/lib/email", () => ({ queueCommerceEmail: vi.fn() }));

const { buildSafeSupportContext, supportPublicId } = await import("@/lib/support");

describe("support ticket isolation and safe context", () => {
  it("creates repository-controlled public ids without customer data", () => {
    expect(supportPublicId(new Date("2026-08-15T00:00:00Z"), "12345678-90ab-cdef-1234-567890abcdef")).toBe("BKE-SUP-2026-1234567890");
  });

  it("rejects cross-account order context", async () => {
    const tx = {
      customerAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acct_1", displayName: "Acme", owner: { id: "user_1", email: "owner@example.com", role: "CUSTOMER", suspendedAt: null, lifecycleState: "ACTIVE" } }) },
      order: { findFirst: vi.fn().mockResolvedValue(null) },
      license: { findFirst: vi.fn() },
    };
    await expect(buildSafeSupportContext(tx as never, { userId: "user_1", accountId: "acct_1", orderId: "order_other" })).rejects.toThrow("ORDER_NOT_FOUND");
    expect(tx.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "order_other", accountId: "acct_1" } }));
  });

  it("returns only minimized order and license context", async () => {
    const tx = {
      customerAccount: { findFirst: vi.fn().mockResolvedValue({ id: "acct_1", displayName: "Acme", owner: { id: "user_1", email: "owner@example.com", role: "CUSTOMER", suspendedAt: null, lifecycleState: "ACTIVE" } }) },
      order: { findFirst: vi.fn().mockResolvedValue({ id: "order_1", number: "ORD-1", status: "PAID", currency: "PHP", totalMinor: 12000, createdAt: new Date("2026-01-01"), paidAt: new Date("2026-01-02") }) },
      license: { findFirst: vi.fn().mockResolvedValue({ id: "lic_1", publicId: "LIC-PUB", status: "ACTIVE", keyLastFour: "ABCD", maxSeats: 1, maxDevicesPerSeat: 2, expiresAt: null, product: { name: "App" }, edition: { name: "Pro" } }) },
    };
    const context = await buildSafeSupportContext(tx as never, { userId: "user_1", accountId: "acct_1", orderId: "order_1", licenseId: "lic_1" }) as Record<string, unknown>;
    expect(JSON.stringify(context)).toContain("LIC-PUB");
    expect(JSON.stringify(context)).toContain("ABCD");
    expect(JSON.stringify(context)).not.toContain("keyCiphertext");
    expect(JSON.stringify(context)).not.toContain("billingSnapshot");
    expect(JSON.stringify(context)).not.toContain("owner@example.com");
  });
});
