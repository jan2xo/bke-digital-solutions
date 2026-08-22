import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    productGraceOverride: { findMany: mocks.findMany, findUnique: mocks.findUnique, upsert: mocks.upsert },
    auditLog: { create: mocks.auditCreate }, $transaction: mocks.transaction,
  },
}));

import { parseGraceBoolean, parseGraceProduct, readGraceStatuses, setGraceState } from "@/lib/grace-period";

describe("operational grace control", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.transaction.mockImplementation(async (callback) => callback({
      productGraceOverride: { findUnique: mocks.findUnique, upsert: mocks.upsert },
      auditLog: { create: mocks.auditCreate },
    }));
  });

  it("accepts only supported products and explicit booleans", () => {
    expect(parseGraceProduct("airstack")).toBe("airstack");
    expect(parseGraceBoolean("true")).toBe(true);
    expect(parseGraceBoolean("false")).toBe(false);
    expect(() => parseGraceProduct("unknown")).toThrow();
    expect(() => parseGraceBoolean("on")).toThrow();
    expect(() => parseGraceBoolean("1")).toThrow();
  });

  it("reports missing rows as false for both products", async () => {
    mocks.findMany.mockResolvedValue([]);
    await expect(readGraceStatuses()).resolves.toEqual({ airstack: false, renderdock: false });
  });

  it("preserves independent persisted values", async () => {
    mocks.findMany.mockResolvedValue([
      { productKey: "airstack", graceEnabled: true },
      { productKey: "renderdock", graceEnabled: false },
    ]);
    await expect(readGraceStatuses()).resolves.toEqual({ airstack: true, renderdock: false });
  });

  it("sets a value and writes an audit event without an actor", async () => {
    mocks.findUnique.mockResolvedValue({ graceEnabled: false });
    await expect(setGraceState("airstack", true)).resolves.toBe(false);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { productKey: "airstack" }, update: { graceEnabled: true }, create: { productKey: "airstack", graceEnabled: true },
    }));
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "GRACE_OVERRIDE_SET", targetType: "ProductGraceOverride", targetId: "airstack",
    }) });
  });

  it("is idempotent when setting the existing value", async () => {
    mocks.findUnique.mockResolvedValue({ graceEnabled: false });
    await expect(setGraceState("renderdock", false)).resolves.toBe(false);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
});
