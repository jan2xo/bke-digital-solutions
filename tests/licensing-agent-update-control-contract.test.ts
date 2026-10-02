import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Licensing Agent update authority control surface", () => {
  it("removes the legacy env-driven unsigned authority", () => {
    const compatibility = readFileSync(
      "platform/distribution/software-catalog.ts",
      "utf8",
    );
    const route = readFileSync(
      "app/api/licensing-agent/update/route.ts",
      "utf8",
    );
    expect(compatibility).not.toContain("BKE_LICENSING_AGENT_LATEST_VERSION");
    expect(compatibility).not.toContain("BKE_LICENSING_AGENT_WINDOWS_X64_URL");
    expect(route).toContain("resolveSignedLicensingAgentUpdate");
    expect(route).not.toContain("downloadUrl");
  });

  it("exposes recent-admin backend controls without adding Admin UI", () => {
    const route = readFileSync(
      "app/api/admin/licensing-agent/update-authority/route.ts",
      "utf8",
    );
    expect(route).toContain("requireRecentAdmin");
    expect(route).toContain("REGISTER_KEY");
    expect(route).toContain("ACTIVATE_KEY");
    expect(route).toContain("RETIRE_KEY");
    expect(route).toContain("REGISTER_RELEASE");
    expect(route).toContain("ACTIVATE_RELEASE");
    expect(route).toContain("DEACTIVATE_RELEASE");
  });

  it("keeps release bytes on GitHub and private signing keys outside the database", () => {
    const service = readFileSync(
      "apps/web/distribution/licensing-agent-update-admin.ts",
      "utf8",
    );
    const migration = readFileSync(
      "prisma/migrations/20261002080000_licensing_agent_update_authority/migration.sql",
      "utf8",
    );
    expect(service).toContain("inspectLicensingAgentGitHubRelease");
    expect(service).toContain("BKE_AGENT_UPDATE_SIGNING_KEYS");
    expect(service).not.toContain("downloadUrl");
    expect(migration).toContain('"privateKeyReference"');
    expect(migration).not.toContain('"privateKey" TEXT');
  });
});
