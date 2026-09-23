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
      executionType: null,
      latestVersion: "1.0.0",
      entitled: true,
    }).installable).toBe(false);

    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      executionType: "STANDALONE",
      latestVersion: null,
      entitled: true,
    }).installable).toBe(false);

    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
      executionType: "STANDALONE",
      latestVersion: "1.0.0",
      entitled: false,
    }).installable).toBe(false);

    expect(projectAgentSoftwareCatalogRow({
      productId: "render-dock",
      displayName: "Render Dock",
      summary: "Render software",
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

  it("fails closed on unknown execution values", () => {
    expect(projectAgentSoftwareCatalogRow({
      productId: "future-product",
      displayName: "Future Product",
      summary: "Future software",
      executionType: "AUTO",
      latestVersion: "1.0.0",
      entitled: true,
    })).toMatchObject({
      executionType: null,
      installable: false,
    });
  });
});
