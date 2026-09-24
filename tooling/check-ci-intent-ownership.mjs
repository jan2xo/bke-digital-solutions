import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const workflowsDir = ".github/workflows";
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

if (
  pullRequestOwners.length !== 1 ||
  pullRequestOwners[0] !== "pr-guard.yml"
) {
  fail(
    `automatic pull_request ownership must belong only to pr-guard.yml; found: ${pullRequestOwners.join(", ") || "none"}`,
  );
}

const guard = read("pr-guard.yml");
for (const required of [
  "pull_request:",
  "Verify certification plan declaration",
  "Verify exact PR head checkout",
  "node tooling/check-ci-intent-ownership.mjs",
  "node tooling/check-module-boundaries.mjs",
]) {
  if (!guard.includes(required)) {
    fail(`pr-guard.yml is missing ${required}`);
  }
}
if (guard.includes("npm ci")) {
  fail("pr-guard.yml must remain lightweight and must not run npm ci");
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
  "v2-platform-audit.yml",
  "v2-platform-email.yml",
  "v2-platform-health.yml",
  "v2-platform-observability.yml",
  "v2-platform-providers.yml",
  "v2-platform-scheduler.yml",
  "v2-platform-storage-cleanup.yml",
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
}

const globalCi = read("ci.yml");
if (!globalCi.includes("push:\n    branches: [main]")) {
  fail("ci.yml must retain post-merge main verification");
}
if (!globalCi.includes("workflow_call:")) {
  fail("ci.yml must remain reusable by certify.yml");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log("Intent-driven CI ownership GREEN");
