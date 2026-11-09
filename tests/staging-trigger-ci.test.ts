import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/legacy-workflows/2026-11-09/stage.yml", "utf8");
const core = readFileSync(".github/workflows/ci.yml", "utf8");

describe("archived PR #266 Staging contract, no active trigger", () => {
  it("keeps obsolete Staging workflows out of active Actions", () => {
    expect(() => readFileSync(".github/workflows/stage.yml", "utf8")).toThrow();
    expect(() => readFileSync(".github/workflows/ci-staging.yml", "utf8")).toThrow();
  });
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
    expect(workflow).toContain("process.env.WORKFLOW_SHA !== trustedSha");
    expect(workflow).not.toContain('test "$WORKFLOW_SHA" = "$SOURCE_SHA"');
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "$SOURCE_SHA"');
    expect(workflow.match(/pr.head.sha !== sourceSha/g)).toHaveLength(1);
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
    expect(workflow).not.toContain("      name: Staging");
    expect(workflow).toContain("Dispatch exact-head branch-owned Staging");
    expect(workflow).toContain('workflow_id: "ci.yml", ref: authorizedBranch');
    expect(workflow).toContain('deploy_staging: "true"');
    const staging = readFileSync(".github/legacy-workflows/2026-11-09/ci-staging.yml", "utf8");
    expect(staging).toContain('environment:\n      name: Staging');
    expect(staging).toContain('id-token: write');
    expect(staging).toContain('if: ${{ needs.core.result == \'success\' }}');
    expect(staging).not.toContain("issue_comment:");
    expect(staging).not.toContain("pull_request:");
    expect(workflow).toContain("PAYMENT_PROVIDER: mock");
    expect(workflow).toContain("EMAIL_PROVIDER: log");
    expect(workflow).not.toContain("Infisical/secrets-action@");
    expect(workflow).toContain("actions: write");
    expect(workflow).toContain("pr.head.sha !== sourceSha");
    expect(workflow).toContain("Browser-accept disposable admin create/edit/archive/delete");
    expect(workflow).toContain("NODE_OPTIONS: --import=tsx");
    expect(workflow).toContain("npm run test:e2e -- tests/e2e/admin-product.spec.ts");
    expect(workflow).toContain("Provider Google OAuth and real staging administrator are not simulated or claimed.");
    expect(workflow).toContain("Exact source SHA: $SOURCE_SHA");
    expect(workflow).toContain("the branch CI run must independently PASS deployment and live smoke");
  });
  it("skips only Docker-only image builds when staging requests it; normal CI remains unchanged", () => {
    expect(core).toContain("skip_containers:");
    expect(core).toContain("default: false");
    expect(core).toContain("if: ${{ !inputs.skip_containers }}");
    expect(core).toContain('if [ "$SKIP_CONTAINERS" != "true" ]; then');
    expect(workflow).toContain("skip_containers: true");
  });
});
