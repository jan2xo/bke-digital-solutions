import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readState: vi.fn(), get: vi.fn() }));
vi.mock("@/v2/apps/web/runtime", () => ({
  getV2WebApplication: vi.fn(async () => ({ get: mocks.get })),
}));

async function getRoute(product: "airstack" | "renderdock") {
  const route = product === "airstack"
    ? await import("@/app/api/graceperiod/airstack/route")
    : await import("@/app/api/graceperiod/renderdock/route");
  return route.GET();
}

describe("product grace endpoints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.get.mockReturnValue({ readState: mocks.readState });
  });

  it("defaults both products to false when the capability reports false", async () => {
    mocks.readState.mockResolvedValue(false);
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: false });
    expect(await (await getRoute("renderdock")).json()).toEqual({ grace: false });
    expect(mocks.readState).toHaveBeenNthCalledWith(1, "airstack");
    expect(mocks.readState).toHaveBeenNthCalledWith(2, "renderdock");
  });

  it("returns explicit false and true values", async () => {
    mocks.readState.mockResolvedValueOnce(false);
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: false });
    mocks.readState.mockResolvedValueOnce(true);
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: true });
  });

  it("keeps product values independent", async () => {
    mocks.readState.mockImplementation((product: string) => Promise.resolve(product === "airstack"));
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: true });
    expect(await (await getRoute("renderdock")).json()).toEqual({ grace: false });
  });

  it("propagates only the fail-closed value returned by the Licensing capability", async () => {
    mocks.readState.mockResolvedValue(false);
    expect(await (await getRoute("airstack")).json()).toEqual({ grace: false });
  });

  it("preserves no-store caching headers", async () => {
    mocks.readState.mockResolvedValue(false);
    const response = await getRoute("renderdock");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
