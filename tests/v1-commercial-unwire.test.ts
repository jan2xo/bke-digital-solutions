import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("commercial control-plane separation", () => {
  it("provides an explicit admin licensing availability control", () => {
    const route = readFileSync("app/api/admin/versions/[id]/licensing/route.ts", "utf8");
    expect(route).toContain("active: z.boolean()");
    expect(route).toContain("data: { active: input.active }");
    expect(route).toContain("PRODUCT_VERSION_LICENSING_ENABLED");
    expect(route).toContain("PRODUCT_VERSION_LICENSING_DISABLED");
  });

  it("keeps catalog lifecycle independent from GitHub release certification", () => {
    const route = readFileSync("app/api/admin/versions/[id]/route.ts", "utf8");
    expect(route).toContain('releaseAuthority: "GITHUB"');
    expect(route).toContain("RELEASE_PUBLICATION_REQUIRES_STABLE");
    expect(route).not.toContain("@/lib/supply-chain/readiness");
    expect(route).not.toContain("@/lib/releases/release-gate");
    expect(route).not.toContain("RELEASE_EVIDENCE_INCOMPLETE");
  });

  it("surfaces independent licensing controls in Release Center", () => {
    const page = readFileSync("app/admin/releases/[id]/page.tsx", "utf8");
    expect(page).toContain("Enable for Licensing");
    expect(page).toContain("Disable for Licensing");
    expect(page).toContain("Independent from GitHub release authority");
    expect(page).toContain("Software release authority");
  });
});
