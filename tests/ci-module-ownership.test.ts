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
  it("gives Agent Store integration one explicit certification owner", () => {
    const workflow = readFileSync(agentStorePath, "utf8");

    for (const test of storeIntegrationTests) {
      expect(workflow).toContain(test);
    }

    expect(workflow).toContain("Store contracts + architecture");
    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain("Verify exact source checkout");
    expect(workflow).not.toContain("pull_request:");
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

  it("routes Agent Store intent through the explicit certifier", () => {
    const workflow = readFileSync(`${workflowsDir}/certify.yml`, "utf8");

    expect(workflow).toContain('"agent-store"');
    expect(workflow).toContain("agent-store:");
    expect(workflow).toContain("uses: ./.github/workflows/v2-agent-store.yml");
    expect(workflow).toContain("required-certification:");
  });

  it("keeps only the lightweight PR guard automatic", () => {
    const owners = readdirSync(workflowsDir)
      .filter((name) => name.endsWith(".yml"))
      .filter((name) =>
        /^\s*pull_request:\s*$/m.test(
          readFileSync(`${workflowsDir}/${name}`, "utf8"),
        ),
      );

    expect(owners).toEqual(["pr-guard.yml"]);

    const guard = readFileSync(`${workflowsDir}/pr-guard.yml`, "utf8");
    expect(guard).toContain("cancel-in-progress: true");
    expect(guard).not.toContain("npm ci");
  });

  it("keeps global CI as explicit certification plus post-merge main verification", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).toContain("name: CI");
    expect(workflow).toContain("push:\n    branches: [main]");
    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("Required certification");
    expect(workflow).toContain("cancel-in-progress: true");
  });
});
