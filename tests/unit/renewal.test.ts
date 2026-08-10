import { describe, expect, it } from "vitest";
import { renewalExpiration } from "@/lib/licensing/renewal";

describe("commercial renewal expiration", () => {
  it("preserves remaining entitlement time for early renewal", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(renewalExpiration(new Date("2026-02-01T00:00:00Z"), now, 30 * 86400000).toISOString()).toBe("2026-03-03T00:00:00.000Z");
  });
  it("starts from effective time when expired", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(renewalExpiration(new Date("2025-12-01T00:00:00Z"), now, 30 * 86400000).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});
