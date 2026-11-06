import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/stage.yml", "utf8");
const core = readFileSync(".github/workflows/ci.yml", "utf8");

describe("intentional exact-head disposable staging", () => {
  it("registers owner-authorized issue-comment and precise-SHA entry points, not push/PR heavy triggers", () => {
    expect(workflow).toContain("issue_comment:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^  pull_request:/m);
    expect(workflow).not.toMatch(/^  push:/m);
    expect(workflow).toContain('(process.env.INPUT_SOURCE_SHA ?? "").trim().toLowerCase() !== sourceSha');
    expect(workflow).toContain('context.actor !== context.repo.owner');
    expect(workflow).toContain('const targetPr = 266');
  });
  it("separates trusted workflow provenance and exact candidate checkout", () => {
    expect(workflow).toContain('pr.head.repo?.full_name !== fullRepo');
    expect(workflow).toContain('currentMain.data.object.sha !== workflowSha');
    expect(workflow).toContain('test "$WORKFLOW_SHA" = "$TRUSTED_WORKFLOW_SHA"');
    expect(workflow).not.toContain('test "$WORKFLOW_SHA" = "$SOURCE_SHA"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$SOURCE_SHA"');
    expect(workflow.match(/pr.head.sha !== process.env.EXPECTED_SOURCE/g)).toHaveLength(2);
  });
  it("requires complete exact-head proof and cancels no in-progress staging", () => {
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("Required exact-head certification aggregate");
    expect(workflow).toContain("needs.workers-application.result == 'success'");
    expect(workflow).toContain("needs.browser-fixture.result == 'success'");
    expect(workflow).toContain("BKE_E2E_DISPOSABLE_DB: '1'");
    expect(workflow).toContain("needs.required-certification.result == 'success'");
    expect(workflow).toContain("const required =");
    expect(workflow).toContain("results[name]?.result !== \"success\"");
    expect(workflow).toContain("needs: [plan, platform]");
    expect(workflow).toContain("needs: [plan, catalog]");
    expect(workflow).toContain("needs: [plan, commerce]");
  });
  it("retains protected disposable Staging, explicit no-real-payments and browser negatives", () => {
    expect(workflow).toContain("name: Staging");
    expect(workflow).toContain("PAYMENT_PROVIDER: mock");
    expect(workflow).toContain("EMAIL_PROVIDER: log");
    expect(workflow).toContain("Infisical/secrets-action@");
    expect(workflow).toContain("Browser-check unauthenticated Staging");
    expect(workflow).toContain("Not verified by this workflow: real Google OAuth");
  });
  it("skips only Docker-only image builds when staging requests it; normal CI remains unchanged", () => {
    expect(core).toContain("skip_containers:");
    expect(core).toContain("default: false");
    expect(core).toContain("if: ${{ !inputs.skip_containers }}");
    expect(core).toContain('if [ "$SKIP_CONTAINERS" != "true" ]; then');
    expect(workflow).toContain("skip_containers: true");
  });
});
