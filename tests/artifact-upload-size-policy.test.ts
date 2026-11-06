import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const retired = [
  "app/api/admin/versions/[id]/artifacts/route.ts",
  "app/api/admin/versions/[id]/artifacts/uploads/route.ts",
  "app/api/admin/versions/[id]/artifacts/uploads/[uploadId]/complete/route.ts",
  "app/api/admin/artifacts/[id]/route.ts",
];

describe("retired server-side artifact handlers", () => {
  it("rejects legacy mutation endpoints with HTTP 410 instead of writing storage", () => {
    for (const path of retired) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain("ARTIFACT_INGESTION_RETIRED");
      expect(source).toContain("status: 410");
      expect(source).not.toContain("uploadObject(");
      expect(source).not.toContain("deleteObject(");
      expect(source).not.toContain("productArtifact.create");
    }
  });
});
