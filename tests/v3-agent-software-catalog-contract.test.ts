import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  launcherExecutionTypes,
  projectAgentSoftwareCatalogRow,
} from "@/apps/web/catalog/agent-software-catalog";

describe("V3 Agent software catalog contract", () => {
  it("keeps execution type owner-controlled and explicit", () => {
    expect(launcherExecutionTypes).toEqual([
      "LAUNCHER_PLUGIN",
      "STANDALONE",
    ]);
  });

  it("refuses installability until entitlement, execution type, and release all exist", () => {
    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      activationMode: "EITHER",
      executionType: null,
      latestVersion: "1.0.0",
      entitled: true,
    }).installable).toBe(false);

    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      activationMode: "EITHER",
      executionType: "STANDALONE",
      latestVersion: null,
      entitled: true,
    }).installable).toBe(false);

    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      activationMode: "EITHER",
      executionType: "STANDALONE",
      latestVersion: "1.0.0",
      entitled: false,
    }).installable).toBe(false);

    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      activationMode: "EITHER",
      executionType: "STANDALONE",
      latestVersion: "1.0.0",
      entitled: true,
    }).installable).toBe(true);
  });

  it("treats durable Entitlement as the source of ownership for both direct and claim-code acquisition", () => {
    const source = readFileSync(
      "apps/web/catalog/agent-software-catalog.ts",
      "utf8",
    );

    expect(source).toContain('FROM "Entitlement" e');
    expect(source).toContain('e."resourceId" = p."id"');
    expect(source).toContain('entitlement_edition."id" = e."resourceId"');
    expect(source).toContain('entitlement_edition."productId" = p."id"');
    expect(source).not.toContain('JOIN "ClaimCode"');
  });

  it("requires an assigned seat for organization software visibility", () => {
    const source = readFileSync(
      "apps/web/catalog/agent-software-catalog.ts",
      "utf8",
    );
    const catalogRoute = readFileSync(
      "app/api/agent-sessions/catalog/route.ts",
      "utf8",
    );
    const provisionRoute = readFileSync(
      "app/api/agent-sessions/provision/standalone/route.ts",
      "utf8",
    );

    expect(source).toContain('ca."type" = \'INDIVIDUAL\'');
    expect(source).toContain('ca."ownerId" = ${input.userId}');
    expect(source).toContain('ca."type" = \'ORGANIZATION\'');
    expect(source).toContain('JOIN "LicenseAssignment" la ON la."licenseId" = l."id"');
    expect(source).toContain('la."userId" = ${input.userId}');
    expect(source).toContain('l."status" = \'ACTIVE\'');
    expect(catalogRoute).toContain("userId: session.userId");
    expect(provisionRoute).toContain("userId: session.userId");
  });

  it("allows one ProductVersion to advertise universal platform/architecture compatibility", () => {
    const source = readFileSync(
      "apps/web/catalog/agent-software-catalog.ts",
      "utf8",
    );
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(schema).toContain("@@unique([productId, version])");
    expect(source).toContain('LOWER(pv."operatingSystem") IN (\'any\', \'universal\')');
    expect(source).toContain('LOWER(pv."architecture") IN (\'any\', \'universal\')');
    expect(source).toContain("IN ('amd64', 'x86_64')");
    expect(source).toContain("= 'aarch64'");
    expect(source).toContain("IN ('i386', 'i686')");
  });

  it("keeps version compatibility owner-editable only through the unpublished release boundary", () => {
    const route = readFileSync(
      "app/api/admin/versions/[id]/route.ts",
      "utf8",
    );
    const manager = readFileSync(
      "components/admin-product-manager.tsx",
      "utf8",
    );
    const apiError = readFileSync(
      "apps/web/http/api-error.ts",
      "utf8",
    );

    expect(route).toContain('operatingSystem: z.enum(["Windows", "macOS", "Linux"]).optional()');
    expect(route).toContain('architecture: z.enum(["x64", "arm64", "universal"]).optional()');
    expect(route).toContain("RELEASE_COMPATIBILITY_EDIT_REQUIRES_UNPUBLISH");
    expect(route).toContain("compatibilityChange && current.publishedAt !== null");
    expect(manager).toContain('fetch(\`/api/admin/versions/\${id}\`');
    expect(manager).toContain('operatingSystem:fields.get("operatingSystem")');
    expect(manager).toContain('architecture:fields.get("architecture")');
    expect(manager).toContain("Unpublish this release before changing operating system or architecture.");
    expect(manager).toContain('version.publishedAt?"Published":"Unpublished"');
    expect(manager).toContain("disabled={Boolean(version.publishedAt)}");
    expect(manager).toContain('href={\`/admin/releases/\${version.id}\`}');
    expect(apiError).toContain("RELEASE_COMPATIBILITY_EDIT_REQUIRES_UNPUBLISH: 409");
  });

  it("never exposes an unpublished ProductVersion as installable", () => {
    const source = readFileSync(
      "apps/web/catalog/agent-software-catalog.ts",
      "utf8",
    );

    expect(source).toContain('pv."publishedAt" IS NOT NULL');
  });

  it("delegates standalone release verification to the existing external GitHub package contract", () => {
    const catalog = readFileSync("apps/web/catalog/agent-software-catalog.ts", "utf8");
    const fixture = readFileSync("scripts/seed-utm-launcher-e2e.ts", "utf8");
    expect(catalog).not.toContain("GITHUB_RELEASE_CONTRACT");
    expect(catalog).toContain('pv."publishedAt" IS NOT NULL');
    expect(catalog).toContain('pv."lifecycle" IN (\'STABLE\', \'LTS\')');
    expect(fixture).toContain("verifyGitHubStandaloneReleaseContract");
    expect(fixture).not.toContain("db.supplyChainEvidence");
    expect(fixture).not.toContain("db.supplyChainVerificationEvidence");
  });

  it("requires entitlement, declared execution type and published version for standalone and bundled plugins", () => {
    const catalog = readFileSync("apps/web/catalog/agent-software-catalog.ts", "utf8");
    expect(catalog).toContain('FROM "Entitlement" e');
    expect(catalog).toContain('pv."active" = TRUE');
    expect(catalog).toContain('pv."publishedAt" IS NOT NULL');

    expect(projectAgentSoftwareCatalogRow({
      productId: "bke-trial-product",
      displayName: "BKE Demo App",
      summary: "Bundled Launcher plugin",
      activationMode: "EITHER",
      executionType: "LAUNCHER_PLUGIN",
      latestVersion: "2.0.0",
      entitled: true,
    })).toMatchObject({
      activationMode: "EITHER",
      executionType: "LAUNCHER_PLUGIN",
      entitled: true,
      installable: true,
    });
  });

  it("fails closed on unknown execution values", () => {
    expect(projectAgentSoftwareCatalogRow({
      productId: "future-product",
      displayName: "Future Product",
      summary: "Future software",
      activationMode: "EITHER",
      executionType: "AUTO",
      latestVersion: "1.0.0",
      entitled: true,
    })).toMatchObject({
      activationMode: "EITHER",
      executionType: null,
      installable: false,
    });
  });
  it("projects SQL-owned activation mode without turning account entitlement into key-only authorization", () => {
    const base = {
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      executionType: "STANDALONE",
      entitled: true,
      latestVersion: "1.0.0",
    };
    expect(projectAgentSoftwareCatalogRow({
      ...base, activationMode: "ACCOUNT",
    })).toMatchObject({ activationMode: "ACCOUNT", entitled: true, installable: true });
    expect(projectAgentSoftwareCatalogRow({
      ...base, activationMode: "EITHER",
    })).toMatchObject({ activationMode: "EITHER", entitled: true, installable: true });
    expect(projectAgentSoftwareCatalogRow({
      ...base, activationMode: "LICENSE_KEY",
    })).toMatchObject({ activationMode: "LICENSE_KEY", entitled: true, installable: false });

    expect(() => projectAgentSoftwareCatalogRow({
      ...base, activationMode: "UNKNOWN",
    })).toThrow("PRODUCT_ACTIVATION_MODE_INVALID");
    expect(() => projectAgentSoftwareCatalogRow({
      ...base, activationMode: undefined as unknown as string,
    })).toThrow("PRODUCT_ACTIVATION_MODE_INVALID");
  });

  it("requires persisted mode on every SQL catalog row and never defaults missing policy to EITHER", () => {
    const catalog = readFileSync("apps/web/catalog/agent-software-catalog.ts", "utf8");
    const route = readFileSync("app/api/agent-sessions/catalog/route.ts", "utf8");
    expect(catalog).toContain('INNER JOIN "ProductActivationPolicy" policy');
    expect(catalog).toContain('policy."activationMode" AS "activationMode"');
    expect(catalog).toContain('allowsProductActivation(activationMode, "ACCOUNT")');
    expect(route).toContain('activation_mode: product.activationMode');
    expect(catalog).not.toContain('COALESCE(policy."activationMode"');
  });

});
