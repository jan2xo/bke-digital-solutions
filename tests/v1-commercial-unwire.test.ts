import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("V1 commercial path separation", () => {
  it("provides an explicit admin licensing availability control", () => {
    const route = readFileSync("app/api/admin/versions/[id]/licensing/route.ts", "utf8");
    expect(route).toContain("active: z.boolean()");
    expect(route).toContain("data: { active: input.active }");
    expect(route).toContain("PRODUCT_VERSION_LICENSING_ENABLED");
    expect(route).toContain("PRODUCT_VERSION_LICENSING_DISABLED");
  });

  it("keeps V2 evidence visible but non-blocking in V1 readiness", () => {
    const readiness = readFileSync("lib/supply-chain/readiness.ts", "utf8");
    expect(readiness).toContain('new Set(["signature", "malware", "approval", "supply-chain-safety"])');
    expect(readiness).toContain("SBOM (V2 evidence)");
    expect(readiness).toContain("PENDING");
  });

  it("surfaces independent licensing controls in Release Center", () => {
    const page = readFileSync("app/admin/releases/[id]/page.tsx", "utf8");
    expect(page).toContain("Enable for Licensing");
    expect(page).toContain("Disable for Licensing");
    expect(page).toContain("Independent from release lifecycle");
  });
});
