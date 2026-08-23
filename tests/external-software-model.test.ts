import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("external software version model", () => {
  it("publishes a version from metadata and an external URL without an installer", () => {
    const route = read("app/api/admin/products/[id]/versions/route.ts");
    const manager = read("components/admin-product-manager.tsx");
    expect(route).toContain("externalUrl: z.string().url()");
    expect(route).toContain('lifecycle: "STABLE"');
    expect(route).not.toContain("supplyChainEvidence.create");
    expect(route).not.toContain("artifactUploadSession.create");
    expect(manager).toContain("External URL");
    expect(manager).not.toContain("uploadArtifact");
    expect(manager).not.toContain('name="installer"');
  });

  it("authorizes the customer before redirecting to the configured URL", () => {
    const route = read("app/api/downloads/[artifactId]/route.ts");
    expect(route).toContain("productVersion.findFirst");
    expect(route).toContain("db.license.findFirst");
    expect(route).toContain("NextResponse.redirect(version.externalUrl");
    expect(route).not.toContain("downloadObject");
    expect(route).not.toContain("downloadGrant.create");
  });

  it("keeps artifact intake endpoints explicitly deferred", () => {
    for (const path of [
      "app/api/admin/versions/[id]/artifacts/route.ts",
      "app/api/admin/versions/[id]/artifacts/uploads/route.ts",
      "app/api/admin/versions/[id]/artifacts/uploads/[uploadId]/complete/route.ts",
    ]) {
      expect(read(path)).toMatch(/SOFTWARE_ARTIFACT_INTAKE_DEFERRED|DIRECT_ARTIFACT_UPLOAD_REQUIRED/);
    }
  });
});
