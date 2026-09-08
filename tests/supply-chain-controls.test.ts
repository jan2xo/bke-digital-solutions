import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("GitHub software release authority", () => {
  it("retires Digital Solutions supply-chain execution behind admin protection", () => {
    const route = read("app/api/admin/supply-chain/route.ts");
    expect(route).toContain("requireAdmin()");
    expect(route).toContain("requireRecentAdmin()");
    expect(route).toContain("assertSameOrigin(request)");
    expect(route).toContain("GITHUB_RELEASE_AUTHORITY");
    expect(route).toContain("status: 410");
    expect(route).not.toContain("@/lib/supply-chain/");
    expect(route).not.toContain("RECORD_");
    expect(route).not.toContain("CERTIFY_");
  });

  it("retires Digital Solutions release-evidence ingestion", () => {
    const route = read("app/api/release-evidence/ingest/route.ts");
    expect(route).toContain("RELEASE_EVIDENCE_INGESTION_RETIRED");
    expect(route).toContain("GitHub is the software release authority");
    expect(route).toContain("status: 410");
    expect(route).not.toContain("@/lib/db");
    expect(route).not.toContain("supplyChainEvidence");
  });

  it("keeps catalog publication protected without re-certifying GitHub releases", () => {
    const route = read("app/api/admin/versions/[id]/route.ts");
    expect(route).toContain("requireRecentAdmin()");
    expect(route).toContain("admin-release-lifecycle:");
    expect(route).toContain("RELEASE_PUBLICATION_REQUIRES_STABLE");
    expect(route).toContain("input.lifecycle !== current.lifecycle");
    expect(route).toContain('releaseAuthority: "GITHUB"');
    expect(route).not.toContain("evaluateReleaseGate");
    expect(route).not.toContain("payloadHash");
    expect(route).not.toContain("RELEASE_REVIEW_REQUIRED");
    expect(route).not.toContain("currentEvidence(");
  });

  it("separates GitHub release authority from licensing and catalog controls", () => {
    const page = read("app/admin/releases/[id]/page.tsx");
    expect(page).toContain("Software release authority");
    expect(page).toContain("GitHub Actions and GitHub Releases");
    expect(page).toContain("Independent from GitHub release authority");
    expect(page).toContain("Enable for Licensing");
    expect(page).toContain("Disable for Licensing");
    expect(page).not.toContain("ReleaseEvidenceControls");
    expect(page).not.toContain("Review Release");
    expect(page).not.toContain("Approve Release");
  });

  it("keeps new product versions non-public by construction", () => {
    const route = read("app/api/admin/products/[id]/versions/route.ts");
    const manager = read("components/admin-product-manager.tsx");
    expect(route).toContain(".strict()");
    expect(route).toContain('lifecycle: "DRAFT"');
    expect(route).toContain("active: false");
    expect(route).toContain("publishedAt: null");
    expect(route).toContain("isLatest: false");
    expect(manager).not.toContain("Publish now");
    expect(manager).toContain("Upload version as DRAFT");
  });
});
