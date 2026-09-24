import { readFileSync } from "node:fs";
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

describe("intent-driven certification foundation", () => {
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
    },
  );

  it("makes global CI callable against an explicit exact SHA", () => {
    const workflow = readFileSync(`${workflowsDir}/ci.yml`, "utf8");

    expect(workflow).toContain("workflow_call:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("source_sha:");
    expect(workflow).toContain(
      "SOURCE_SHA: ${{ inputs.source_sha || github.event.pull_request.head.sha || github.sha }}",
    );
    expect(workflow).toContain("ref: ${{ env.SOURCE_SHA }}");
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

  it("keeps full certification explicit and rare", () => {
    const workflow = readFileSync(`${workflowsDir}/certify.yml`, "utf8");

    expect(workflow).toContain('tokens.includes("full")');
    expect(workflow).toContain("targets = allowedTargets");
    expect(workflow).not.toContain("pull_request:");
  });
});
