import { describe, expect, it } from "vitest";

describe("product grace endpoints", () => {
  it("defaults AIRSTACK grace to false", async () => {
    const { GET } = await import("@/app/api/graceperiod/airstack/route");
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ grace: false });
  });

  it("defaults RENDERDOCK grace to false", async () => {
    const { GET } = await import("@/app/api/graceperiod/renderdock/route");
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ grace: false });
  });
});
