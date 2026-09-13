import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("V2 Privacy + Catalog released-package adoption", () => {
  it("keeps the retired legacy frontier implementations absent", () => {
    expect(existsSync("lib/privacy/requests.ts")).toBe(false);
    expect(existsSync("lib/product-deletion.ts")).toBe(false);
  });

  it("routes privacy through the V2 released-package adapter", () => {
    const publicRoute = read("app/api/privacy/requests/route.ts");
    const adminRoute = read("app/api/admin/privacy/requests/route.ts");
    const adapter = read("v2/apps/web/privacy/requests.ts");

    expect(publicRoute).toContain("@/v2/apps/web/privacy/requests");
    expect(adminRoute).toContain("@/v2/apps/web/privacy/requests");
    expect(publicRoute).not.toContain("@/lib/privacy/requests");
    expect(adminRoute).not.toContain("@/lib/privacy/requests");
    expect(adapter).toContain("@bke/privacy/contracts/privacy-request-policy.contract");
    expect(adapter).toContain("@bke/privacy/logic/privacy-request-policy");
    expect(adapter).toContain("planPrivacyRequestCreation");
    expect(adapter).toContain("planPrivacyRequestTransition");
  });

  it("routes product deletion through the V2 released-package adapter", () => {
    const route = read("app/api/admin/products/[id]/deletion/route.ts");
    const adapter = read("v2/apps/web/catalog/product-deletion.ts");

    expect(route).toContain("@/v2/apps/web/catalog/product-deletion");
    expect(route).not.toContain("@/lib/product-deletion");
    expect(adapter).toContain("@bke/catalog/contracts/product-deletion-policy.contract");
    expect(adapter).toContain("@bke/catalog/logic/product-deletion-policy");
    expect(adapter).toContain("planCatalogProductDeletionRequest");
    expect(adapter).toContain("planCatalogProductDeletionFinalization");
    expect(adapter).toContain("@/v2/apps/web/storage/cleanup");
  });

  it("pins only immutable released Privacy and Catalog artifacts", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@bke/privacy"]).toBe(
      "https://github.com/jan2xo/bke-libraries-typescript/releases/download/privacy-v0.1.0/bke-privacy-0.1.0.tgz",
    );
    expect(pkg.dependencies["@bke/catalog"]).toBe(
      "https://github.com/jan2xo/bke-libraries-typescript/releases/download/catalog-v0.6.0/bke-catalog-0.6.0.tgz",
    );
  });
});
