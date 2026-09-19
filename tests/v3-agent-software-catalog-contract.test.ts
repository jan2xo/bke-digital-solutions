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
