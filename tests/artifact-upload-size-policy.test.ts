import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retiredRoutes = [
  "app/api/admin/versions/[id]/artifacts/route.ts",
  "app/api/admin/versions/[id]/artifacts/uploads/route.ts",
  "app/api/admin/versions/[id]/artifacts/uploads/[uploadId]/complete/route.ts",
];

describe("software artifact ingestion retirement", () => {
  it("returns a stable 410 from every former software artifact ingestion endpoint", () => {
    for (const path of retiredRoutes) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("ARTIFACT_INGESTION_RETIRED");
      expect(source).toContain("GitHub Releases is the software distribution authority");
      expect(source).toContain("status: 410");
    }
  });

  it("does not hide Digital Solutions upload or verification authority behind the retired routes", () => {
    const start = readFileSync(retiredRoutes[1], "utf8");
    const complete = readFileSync(retiredRoutes[2], "utf8");
    const uploader = readFileSync("components/direct-artifact-uploader.tsx", "utf8");

    expect(start).not.toContain("createArtifactUploadUrl");
    expect(start).not.toContain("artifactUploadSession.create");
    expect(complete).not.toContain("verifyStoredArtifact");
    expect(complete).not.toContain("ensureCommissioningRun");
    expect(complete).not.toContain("productArtifact.create");
    expect(uploader).not.toContain("/artifacts/uploads");
    expect(uploader).toContain("GitHub Releases");
  });
});
