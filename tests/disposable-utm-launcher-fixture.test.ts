import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = readFileSync("scripts/seed-utm-launcher-e2e.ts", "utf8");
const compose = readFileSync("scripts/v3-disposable-compose.mjs", "utf8");
const ops = readFileSync("scripts/v3-ops.sh", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("disposable UTM Launcher fixture", () => {
  it("fails closed outside the isolated disposable authority", () => {
    expect(fixture).toContain('BKE_DISPOSABLE_CERTIFICATION !== "true"');
    expect(fixture).toContain('DEPLOYMENT_ENV !== "test"');
    expect(fixture).toContain('APP_URL !== "https://bke-v3.test:8443"');
    expect(fixture).toContain('PAYMENT_PROVIDER !== "mock"');
    expect(fixture).toContain('PAYMONGO_LIVEMODE !== "false"');
    expect(fixture).toContain("UTM_FIXTURE_REFUSES_PAYMONGO_SECRETS");
    expect(fixture).toContain('EMAIL_PROVIDER !== "log"');
    expect(fixture).toContain('BKE_DISABLE_EXTERNAL_EMAIL !== "true"');
    expect(fixture).toContain("UTM_FIXTURE_REFUSES_RESEND_SECRET");
  });

  it("uses generation-free capability flags and requires native Agent sessions", () => {
    expect(fixture).toContain('CLAIM_CODE_CHECKOUT_ENABLED !== "false"');
    expect(fixture).toContain('AGENT_ACCOUNT_SESSION_ENABLED !== "true"');
    expect(fixture).not.toMatch(/\bV\d+_(?:CLAIM_CODE_CHECKOUT_ENABLED|AGENT_ACCOUNT_SESSION_ENABLED)\b/);
  });

  it("pins the real Render Dock standalone certification target", () => {
    expect(fixture).toContain('const PRODUCT_ID = "bke-render-dock"');
    expect(fixture).toContain('const PRODUCT_VERSION = "1.0.3"');
    expect(fixture).toContain('launcherExecutionType: "STANDALONE"');
    const standaloneSection = fixture.slice(
      fixture.indexOf("const existingProduct"),
      fixture.indexOf("const existingPluginProduct"),
    );
    expect(standaloneSection).toContain('architecture: "x64"');
    expect(standaloneSection).not.toContain('architecture: "universal"');
    expect(fixture).toContain("verifyGitHubStandaloneReleaseContract");
    expect(fixture).toContain('"GITHUB_RELEASE_CONTRACT"');
    expect(fixture).toContain("releaseContractVerified: true");
    expect(fixture).toContain('"Entitlement"');
  });

  it("adds the first real Launcher plugin without standalone release baggage", () => {
    expect(fixture).toContain('const PLUGIN_PRODUCT_ID = "bke-trial-product"');
    expect(fixture).toContain('const PLUGIN_PRODUCT_VERSION = "2.0.0"');
    expect(fixture).toContain('launcherExecutionType: "LAUNCHER_PLUGIN"');
    expect(fixture).toContain('operatingSystem: "Any"');
    expect(fixture).toContain('architecture: "universal"');
    expect(fixture).toContain("pluginProduct.id");
    expect(fixture).toContain('executionType: "LAUNCHER_PLUGIN"');
    expect(fixture).toContain('standaloneReleaseEvidenceRequired: false');

    const pluginSection = fixture.slice(
      fixture.indexOf("const existingPluginProduct"),
      fixture.indexOf("console.info(JSON.stringify"),
    );
    expect(pluginSection).not.toContain("verifyGitHubStandaloneReleaseContract");
    expect(pluginSection).not.toContain('"GITHUB_RELEASE_CONTRACT"');
    expect(pluginSection).not.toContain("supplyChainEvidence");
  });

  it("creates a verified CUSTOMER with a generated password", () => {
    expect(fixture).toContain('role: "CUSTOMER"');
    expect(fixture).toContain("emailVerified: now");
    expect(fixture).toContain("createArgon2PasswordHasher");
    expect(fixture).toContain("randomBytes(18)");
    expect(fixture).toContain("UTM_FIXTURE_CUSTOMER_ACCOUNT_SELECTION_NOT_DETERMINISTIC");
  });

  it("is exposed only through the disposable operator path", () => {
    expect(pkg.scripts["disposable:utm-fixture"]).toContain("seed-utm-launcher-e2e.ts");
    expect(compose).toContain('case "utm-fixture"');
    expect(compose).toContain('"disposable:utm-fixture"');
    expect(ops).toContain("disposable-utm-fixture");
  });
});
