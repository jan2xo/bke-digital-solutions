import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { productGraceOverride: { findUnique: mocks.findUnique } } }));

async function getRoute(product: "airstack" | "renderdock") {
  const route = product === "airstack"
    ? await import("@/app/api/graceperiod/airstack/route")
    : await import("@/app/api/graceperiod/renderdock/route");
  return route.GET();
}

describe("product grace endpoints", () => {
  beforeEach(() => vi.resetAllMocks());

  it("defaults both products to false when rows are missing", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: false });
    expect(await (await getRoute("renderdock")).json()).toEqual({ grace: false });
  });

  it("returns explicit false and true values", async () => {
    mocks.findUnique.mockResolvedValueOnce({ graceEnabled: false });
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: false });
    mocks.findUnique.mockResolvedValueOnce({ graceEnabled: true });
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: true });
  });

  it("keeps product values independent", async () => {
    mocks.findUnique.mockImplementation(({ where }: { where: { productKey: string } }) =>
      Promise.resolve({ graceEnabled: where.productKey === "airstack" }));
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: true });
    expect(await (await getRoute("renderdock")).json()).toEqual({ grace: false });
  });

  it("fails closed when the database read fails", async () => {
    mocks.findUnique.mockRejectedValue(new Error("database unavailable"));
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: false });
  });

  it("preserves no-store caching headers", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const response = await getRoute("renderdock");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
