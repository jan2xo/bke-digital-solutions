import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDir = ".github/workflows";
const legacyDir = ".github/legacy-workflows/2026-10-02";
const retiredPlatformWorkflows = [
  "v2-platform-audit.yml",
  "v2-platform-email.yml",
  "v2-platform-health.yml",
  "v2-platform-observability.yml",
  "v2-platform-providers.yml",
  "v2-platform-scheduler.yml",
  "v2-platform-storage-cleanup.yml",
];

const workflowNames = readdirSync(workflowsDir).filter((name) => name.endsWith(".yml"));

function read(name) {
  return readFileSync(join(workflowsDir, name), "utf8");
}

function fail(message) {
  console.error(`CI intent ownership violation: ${message}`);
  process.exitCode = 1;
}

const pullRequestOwners = workflowNames.filter((name) =>
  /^\s*pull_request:\s*$/m.test(read(name)),
);
const pushOwners = workflowNames.filter((name) =>
  /^\s{2}push:\s*$/m.test(read(name)),
);

if (pullRequestOwners.length !== 0) {
  fail(
    `automatic pull_request certification is forbidden; found: ${pullRequestOwners.join(", ")}`,
  );
}
if (pushOwners.length !== 0) {
  fail(
    `ordinary push certification is forbidden; found: ${pushOwners.join(", ")}`,
  );
}
if (workflowNames.includes("pr-guard.yml")) {
  fail("pr-guard.yml must remain legacy-only");
}
if (!existsSync(join(legacyDir, "pr-guard.yml"))) {
  fail("legacy PR guard archive is missing");
}

for (const name of retiredPlatformWorkflows) {
  if (workflowNames.includes(name)) {
    fail(`${name} is retired; platform certification belongs to v2-platform.yml`);
  }
}

const certify = read("certify.yml");
for (const required of [
  "issue_comment:",
  "workflow_dispatch:",
  "required-certification:",
  "response.data.head.sha",
  "targets_json",
]) {
  if (!certify.includes(required)) {
    fail(`certify.yml is missing ${required}`);
  }
}
if (/^\s*pull_request:\s*$/m.test(certify)) {
  fail("certify.yml must not auto-run on pull_request");
}

const exactHeadWorkflows = [
  "ci.yml",
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
  "v2-platform.yml",
  "v2-prisma-isolation.yml",
  "v2-standalone.yml",
];

for (const name of exactHeadWorkflows) {
  const workflow = read(name);
  if (!workflow.includes("workflow_dispatch:")) {
    fail(`${name} must expose workflow_dispatch`);
  }
  if (!workflow.includes("source_sha:")) {
    fail(`${name} must accept an explicit source_sha`);
  }
  if (!workflow.includes("Verify exact source checkout")) {
    fail(`${name} must verify the checked-out exact source SHA`);
  }
  if (/^\s*pull_request:\s*$/m.test(workflow)) {
    fail(`${name} must not auto-run on pull_request`);
  }
  if (/^\s{2}push:\s*$/m.test(workflow)) {
    fail(`${name} must not auto-run on push`);
  }
  if (workflow.includes("github.event.pull_request")) {
    fail(`${name} must not depend on pull_request event context`);
  }
}

const platformWorkflow = read("v2-platform.yml");
for (const required of [
  "platform/audit/test/audit.test.ts",
  "platform/email/test/email.test.ts",
  "platform/health/test/health.test.ts",
  "platform/observability/test/observability.test.ts",
  "platform/providers/test/providers.test.ts",
  "platform/scheduler/test/scheduler.test.ts",
  "platform/storage-cleanup/test/storage-cleanup.test.ts",
]) {
  if (!platformWorkflow.includes(required)) {
    fail(`v2-platform.yml is missing consolidated ownership for ${required}`);
  }
}

const globalCi = read("ci.yml");
if (globalCi.includes("push:\n    branches: [main]")) {
  fail("ci.yml must not auto-run as post-merge main verification");
}
if (!globalCi.includes("workflow_call:")) {
  fail("ci.yml must remain reusable by certify.yml");
}
if (!globalCi.includes("workflow_dispatch:")) {
  fail("ci.yml must remain explicitly dispatchable");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("Intentional CI ownership GREEN");
