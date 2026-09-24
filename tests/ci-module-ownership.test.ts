import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowsDir = ".github/workflows";
const agentStorePath = `${workflowsDir}/v2-agent-store.yml`;

const formerStoreOwners = [
  "v2-accounts.yml",
  "v2-catalog.yml",
  "v2-commerce.yml",
  "v2-identity.yml",
  "v2-legal.yml",
  "v2-licensing.yml",
  "v2-payments.yml",
] as const;

const storeIntegrationPaths = [
  "app/api/agent-sessions/store/**",
  "app/api/checkout/route.ts",
  "apps/web/catalog/agent-store-catalog.ts",
  "apps/web/licensing/self-purchase-continuation.ts",
  "apps/web/licensing/self-purchase-continuation-policy.ts",
] as const;

const storeIntegrationTests = [
  "tests/v3-agent-store-catalog-contract.test.ts",
  "tests/agent-session-checkout-review.test.ts",
  "tests/agent-session-checkout-start.test.ts",
  "tests/agent-session-checkout-status.test.ts",
  "tests/licensing-self-purchase-continuation.test.ts",
  "tests/licensing-self-purchase-route-adoption.test.ts",
] as const;

describe("CI module ownership", () => {
  it("gives Agent Store integration one owner for Store adapter certification", () => {
    const workflow = readFileSync(agentStorePath, "utf8");

    for (const path of storeIntegrationPaths) {
      expect(workflow).toContain(path);
    }
    for (const test of storeIntegrationTests) {
      expect(workflow).toContain(test);
    }

    expect(workflow).toContain("Store contracts + architecture");
    expect(workflow).toContain("cancel-in-progress: true");
  });

  it.each(formerStoreOwners)(
    "%s no longer owns cross-module Store adapter tests",
    (name) => {
      const workflow = readFileSync(`${workflowsDir}/${name}`, "utf8");

      for (const path of storeIntegrationPaths) {
        expect(workflow).not.toContain(path);
      }
      for (const test of storeIntegrationTests) {
        expect(workflow).not.toContain(test);
      }
    },
  );

  it("cancels stale PR workflow generations repository-wide", () => {
    const workflowNames = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );

    for (const name of workflowNames) {
      const workflow = readFileSync(`${workflowsDir}/${name}`, "utf8");
      if (!workflow.includes("pull_request:")) continue;

      expect(workflow, name).toContain("concurrency:");
      expect(workflow, name).toContain("cancel-in-progress: true");
    }
  });

  it("keeps the global CI aggregate certification gate", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).toContain("name: CI");
    expect(workflow).toContain("push:\n    branches: [main]");
    expect(workflow).toContain("pull_request:\n    branches: [main]");
    expect(workflow).toContain("Required certification");
    expect(workflow).toContain("cancel-in-progress: true");
  });
});
