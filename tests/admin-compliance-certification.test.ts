import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/admin/supply-chain/route.ts", "utf8");
const supplyChainPage = readFileSync("app/admin/supply-chain/page.tsx", "utf8");
const releasePage = readFileSync("app/admin/releases/[id]/page.tsx", "utf8");

describe("GitHub release authority", () => {
  it("retires the Digital Solutions supply-chain execution API behind admin auth", () => {
    expect(route).toContain("requireRecentAdmin()");
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("GITHUB_RELEASE_AUTHORITY");
    expect(route).toContain("status: 410");
    expect(route).not.toContain("CERTIFY_COMPLIANCE");
    expect(route).not.toContain("@/lib/supply-chain/");
  });

  it("moves release-security execution out of the Digital Solutions admin UI", () => {
    expect(supplyChainPage).toContain("Managed in GitHub");
    expect(supplyChainPage).toContain("GitHub Actions and GitHub Releases");
    expect(releasePage).toContain("Software release authority");
    expect(releasePage).toContain("GitHub Actions and GitHub Releases");
    expect(releasePage).not.toContain("releaseReadiness");
    expect(releasePage).not.toContain("CERTIFY_COMPLIANCE");
  });
});
