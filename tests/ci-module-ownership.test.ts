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
    const orchestrator = readFileSync(`${workflowsDir}/certify.yml`, "utf8");

    for (const test of storeIntegrationTests) {
      expect(workflow).toContain(test);
    }

    expect(workflow).toContain("Store contracts + architecture");
    expect(orchestrator).toContain("uses: ./.github/workflows/v2-agent-store.yml");
  });

  it.each(formerStoreOwners)(
    "%s no longer owns cross-module Store adapter tests",
    (name) => {
      const workflow = readFileSync(`${workflowsDir}/${name}`, "utf8");

      for (const test of storeIntegrationTests) {
        expect(workflow).not.toContain(test);
      }
    },
  );

  it("keeps PR automation limited to the lightweight intent guard", () => {
    const workflowNames = readdirSync(workflowsDir).filter((name) =>
      name.endsWith(".yml"),
    );
    const automaticPrWorkflows = workflowNames.filter((name) =>
      readFileSync(`${workflowsDir}/${name}`, "utf8").includes("pull_request:"),
    );

    expect(automaticPrWorkflows).toEqual(["pr-intent-guard.yml"]);

    const guard = readFileSync(
      `${workflowsDir}/pr-intent-guard.yml`,
      "utf8",
    );
    expect(guard).toContain("cancel-in-progress: true");
    expect(guard).not.toContain("npm ci");
    expect(guard).not.toContain("actions/checkout");
  });

  it("keeps global CI as manual/callable plus post-merge main verification", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).toContain("name: CI");
    expect(workflow).toContain("push:\n    branches: [main]");
    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("Required certification");
  });
});
