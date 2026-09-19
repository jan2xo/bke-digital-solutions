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
