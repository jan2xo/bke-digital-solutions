import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const retiredPages = [
  "app/admin/artifacts/page.tsx",
  "app/admin/supply-chain/page.tsx",
  "app/admin/scanner/page.tsx",
];
const retiredEndpoints = [
  "app/api/admin/supply-chain/route.ts",
  "app/api/release-evidence/ingest/route.ts",
  "app/api/admin/versions/[id]/artifacts/route.ts",
  "app/api/admin/versions/[id]/artifacts/uploads/route.ts",
  "app/api/admin/versions/[id]/artifacts/uploads/[uploadId]/complete/route.ts",
  "app/api/admin/artifacts/[id]/route.ts",
];

describe("Digital Solutions Supply Chain retirement", () => {
  it("removes the retired admin UI rather than merely hiding its navigation links", () => {
    for (const path of retiredPages) expect(existsSync(path)).toBe(false);
    const nav = read("components/admin-nav.tsx");
    expect(nav).not.toContain('"/admin/supply-chain"');
    expect(nav).not.toContain('"/admin/scanner"');
    expect(nav).not.toContain('"/admin/artifacts"');
  });
  it("preserves explicit 410 without server-side ingestion, scanning or S3 mutation", () => {
    for (const path of retiredEndpoints) {
      const source = read(path);
      expect(source).toContain("status: 410");
      expect(source).not.toContain("uploadObject(");
      expect(source).not.toContain("deleteObject(");
      expect(source).not.toContain("supplyChainEvidence.create");
      expect(source).not.toContain("scanArtifact(");
    }
  });
  it("removes Supply Chain execution scripts and protected config keys", () => {
    const packageJson = read("package.json");
    const config = read("platform/host/config/environment.ts");
    for (const term of ["supplychain:", "SUPPLY_CHAIN_SIGNING", "MALWARE_SCANNER_", "RELEASE_EVIDENCE_INGESTION_TOKEN"]) {
      expect(packageJson).not.toContain(term);
      expect(config).not.toContain(term);
    }
    expect(existsSync("lib/supply-chain/scanner.ts")).toBe(false);
    expect(existsSync("lib/supply-chain/signing.ts")).toBe(false);
  });
  it("retains admin-authenticated catalog lifecycle and licensed download policy", () => {
    const publication = read("app/api/admin/versions/[id]/route.ts");
    expect(publication).toContain("requireRecentAdmin()");
    expect(publication).toContain("RELEASE_PUBLICATION_REQUIRES_STABLE");
    expect(publication).not.toContain("releaseReadiness");
    const download = read("app/api/licenses/[id]/download/route.ts");
    expect(download).toContain("requireUser()");
    expect(download).toContain('status: "ACTIVE"');
    expect(download).toContain("githubLatestReleaseUrl");
    expect(read("apps/web/catalog/agent-software-catalog.ts")).not.toContain("SupplyChainEvidence");
  });
});
