import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowsDir = ".github/workflows";

const callableWorkflows = [
  "native-bke-account-handoff.yml",
  "v2-accounts.yml",
  "v2-agent-store.yml",
  "v2-catalog.yml",
  "v2-commerce.yml",
  "v2-composition.yml",
  "v2-echo.yml",
  "v2-entitlements.yml",
  "v2-host-v1-free.yml",
  "v2-identity.yml",
  "v2-legal.yml",
  "v2-licensing.yml",
  "v2-notifications.yml",
  "v2-payments.yml",
  "v2-prisma-isolation.yml",
  "v2-standalone.yml",
] as const;

const explicitConcurrencyGroups = new Map<string, string>([
  ["v2-composition.yml", "group: composition-${{ inputs.source_sha }}"],
  ["v2-host-v1-free.yml", "group: host-v1-free-${{ inputs.source_sha }}"],
  ["v2-prisma-isolation.yml", "group: prisma-isolation-${{ inputs.source_sha }}"],
  ["v2-catalog.yml", "group: catalog-${{ inputs.source_sha }}"],
  ["v2-commerce.yml", "group: commerce-${{ inputs.source_sha }}"],
  ["v2-payments.yml", "group: payments-${{ inputs.source_sha }}"],
  ["v2-licensing.yml", "group: licensing-${{ inputs.source_sha }}"],
  ["v2-entitlements.yml", "group: entitlements-${{ inputs.source_sha }}"],
  ["v2-notifications.yml", "group: notifications-${{ inputs.source_sha }}"],
  ["v2-standalone.yml", "group: standalone-${{ inputs.source_sha }}"],
  [
    "native-bke-account-handoff.yml",
    "group: native-bke-account-${{ inputs.source_sha }}",
  ],
  [
    "v2-identity.yml",
    "group: identity-${{ inputs.source_sha }}",
  ],
  [
    "v2-accounts.yml",
    "group: accounts-${{ inputs.source_sha }}",
  ],
  [
    "v2-legal.yml",
    "group: legal-${{ inputs.source_sha }}",
  ],
]);

describe("intent-driven certification foundation", () => {
  it("isolates the composed host and Prisma workflows while deduplicating the same source", () => {
    const groups = ["v2-composition.yml", "v2-host-v1-free.yml", "v2-prisma-isolation.yml"]
      .map((name) => readFileSync(`${workflowsDir}/${name}`, "utf8").match(/^  group: (.+)$/m)?.[1]);
    expect(groups.every((group) => group?.includes("inputs.source_sha"))).toBe(true);
    expect(new Set(groups).size).toBe(groups.length);
  });
  it("accepts explicit certification intent instead of guessing ownership", () => {
    const workflow = readFileSync(`${workflowsDir}/certify.yml`, "utf8");

    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("startsWith(github.event.comment.body, '/certify ')");
    expect(workflow).toContain('"OWNER", "MEMBER", "COLLABORATOR"');
    expect(workflow).toContain("response.data.head.sha");
    expect(workflow).toContain('"source_sha"');
    expect(workflow).toContain('"targets_json"');
    expect(workflow).toContain("required-certification:");
    expect(workflow).toContain("Required certification");
  });

  it.each(callableWorkflows)(
    "%s is reusable and verifies the exact requested source SHA",
    (name) => {
      const workflow = readFileSync(`${workflowsDir}/${name}`, "utf8");

      expect(workflow).toContain("workflow_call:");
      expect(workflow).toContain("source_sha:");
      expect(workflow).toContain("Verify exact source checkout");
      expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$EXPECTED_SOURCE_SHA"');
      expect(workflow).toContain(
        explicitConcurrencyGroups.get(name) ??
          "group: ${{ github.workflow }}-${{ inputs.source_sha }}",
      );
      expect(workflow).not.toContain("github.event.pull_request");
    },
  );

  it("keeps sibling composition, host and Prisma runs isolated under a shared caller", () => {
    const groups = ["v2-composition.yml", "v2-host-v1-free.yml", "v2-prisma-isolation.yml"]
      .map((name) => {
        const workflow = readFileSync(`${workflowsDir}/${name}`, "utf8");
        expect(workflow).toContain("cancel-in-progress: true");
        const group = workflow.match(/^  group: (.+)$/m)?.[1];
        expect(group).toContain("inputs.source_sha");
        expect(group).not.toContain("github.workflow");
        return group;
      });
    expect(new Set(groups).size).toBe(3);
  });

  it("makes global CI callable against an explicit exact SHA", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain("skip_containers:");
    expect(workflow).toContain("if: ${{ !inputs.skip_containers }}");
    expect(workflow).toContain(
      "SOURCE_SHA: ${{ inputs.source_sha || github.sha }}",
    );
    expect(workflow).toContain("ref: ${{ env.SOURCE_SHA }}");
    expect(workflow).toContain(
      "group: ${{ inputs.deploy_staging && format('digital-solutions-staging-{0}', inputs.source_sha) || format('digital-solutions-ci-{0}', inputs.source_sha || github.ref) }}",
    );
    expect(workflow).toContain("cancel-in-progress: ${{ !inputs.deploy_staging }}");
    expect(workflow).toContain("default: false");
    expect(workflow).toContain(
      "if: ${{ github.event_name == 'workflow_dispatch' && inputs.deploy_staging == true && needs.required-certification.result == 'success' }}",
    );
    const stagingJob = workflow.split("  staging-deploy:\n")[1]?.split("\n  required-certification:")[0];
    expect(stagingJob).toContain("cancel-in-progress: false");
    expect(workflow).not.toContain("github.event.pull_request");
    expect(workflow).not.toContain("push:");
  });

  it("consolidates platform seam certification into one restore/typecheck owner", () => {
    const workflow = readFileSync(`${workflowsDir}/v2-platform.yml`, "utf8");

    expect(workflow).toContain("workflow_call:");
    expect(workflow.match(/npm ci/g)).toHaveLength(1);
    expect(workflow.match(/Typecheck architecture/g)).toHaveLength(1);

    for (const testPath of [
      "platform/audit/test/audit.test.ts",
      "platform/email/test/email.test.ts",
      "platform/health/test/health.test.ts",
      "platform/observability/test/observability.test.ts",
      "platform/providers/test/providers.test.ts",
      "platform/scheduler/test/scheduler.test.ts",
      "platform/storage-cleanup/test/storage-cleanup.test.ts",
    ]) {
      expect(workflow).toContain(testPath);
    }
  });

  it("retires duplicate platform workflow owners", () => {
    for (const retired of [
      "v2-platform-audit.yml",
      "v2-platform-email.yml",
      "v2-platform-health.yml",
      "v2-platform-observability.yml",
      "v2-platform-providers.yml",
      "v2-platform-scheduler.yml",
      "v2-platform-storage-cleanup.yml",
    ]) {
      expect(existsSync(`${workflowsDir}/${retired}`)).toBe(false);
    }
  });

  it("keeps full certification explicit and rare", () => {
    const workflow = readFileSync(`${workflowsDir}/certify.yml`, "utf8");

    expect(workflow).toContain('tokens.includes("full")');
    expect(workflow).toContain("targets = allowedTargets");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain(
      "startsWith(github.event.comment.body, '/certify ')",
    );
    expect(workflow).toContain("github.event.issue.number");
    expect(workflow).toContain("inputs.source_sha");
    expect(workflow).toContain("github.run_id");
  });
});
