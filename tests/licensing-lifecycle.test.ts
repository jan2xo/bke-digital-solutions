import { describe, expect, it } from "vitest";
import { nextLeaseLifecycle, requireProductVersion } from "@/lib/licensing/lifecycle";

describe("commercial lease lifecycle", () => {
  it("starts at generation and revision one", () => {
    expect(nextLeaseLifecycle()).toEqual({ generation: 1, serverRevision: 1 });
  });

  it("progresses both counters without resetting history", () => {
    expect(nextLeaseLifecycle({ generation: 3, serverRevision: 7 })).toEqual({ generation: 4, serverRevision: 8 });
  });

  it("rejects placeholder or missing product versions", () => {
    expect(() => requireProductVersion(undefined)).toThrow("INVALID_LICENSE_VERSION");
    expect(() => requireProductVersion("0.0.0")).toThrow("INVALID_LICENSE_VERSION");
    expect(() => requireProductVersion("not-a-version")).toThrow("INVALID_LICENSE_VERSION");
  });
});
