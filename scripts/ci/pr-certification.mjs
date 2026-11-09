import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_TARGETS = new Set([
  "pr", "core", "accounts", "agent-store", "catalog", "commerce", "composition",
  "echo", "entitlements", "host", "identity", "legal", "licensing", "notifications",
  "payments", "platform", "prisma-isolation", "standalone", "native-account",
]);
const TEST_NAME = /^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:test|certify)\.[cm]?[jt]s$/;

export function validatePrPlan(plan, pr, fileExists = existsSync) {
  if (!Number.isSafeInteger(pr) || pr <= 0 || plan === null || typeof plan !== "object" ||
      Array.isArray(plan) || plan.schemaVersion !== 1 || plan.pr !== pr ||
      typeof plan.intent !== "string" || plan.intent.trim().length < 10 ||
      plan.intent.length > 400 || !Array.isArray(plan.requiredTargets) ||
      plan.requiredTargets.length === 0 || !plan.requiredTargets.includes("pr") ||
      new Set(plan.requiredTargets).size !== plan.requiredTargets.length ||
      !plan.requiredTargets.every(x => ALLOWED_TARGETS.has(x))) {
    throw new Error("PR_CERTIFICATION_INVALID_PLAN");
  }
  const files = plan.testFiles;
  if (!Array.isArray(files) || files.length === 0 || files.length > 40 ||
      new Set(files).size !== files.length ||
      !files.every(x => typeof x === "string" && TEST_NAME.test(x) && fileExists(x))) {
    throw new Error("PR_CERTIFICATION_INVALID_TESTS");
  }
  return { ...plan, testFiles: [...files], requiredTargets: [...plan.requiredTargets] };
}

export function readPrPlan(pr, root = process.cwd()) {
  const path = resolve(root, ".github", "pr-certification", "pr-" + pr + ".json");
  const plan = JSON.parse(readFileSync(path, "utf8"));
  return validatePrPlan(plan, pr, (file) => existsSync(resolve(root, file)));
}

export function runPrCertification(pr, sha, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("PR_CERTIFICATION_INVALID_SHA");
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  if (git.status !== 0 || git.stdout.trim() !== sha) {
    throw new Error("PR_CERTIFICATION_HEAD_MISMATCH");
  }
  const plan = readPrPlan(pr, cwd);
  process.stdout.write(`PR #${pr} scoped certification: ${plan.intent}\nExact head: ${sha}\n`);
  for (const file of plan.testFiles) process.stdout.write(`  ${file}\n`);
  const result = spawnSync("npm", ["test", "--", ...plan.testFiles], {
    cwd, stdio: "inherit", shell: false,
    env: { ...process.env, CI: "true" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("PR_CERTIFICATION_FAILED");
}

if (process.argv[1] && basename(fileURLToPath(import.meta.url)) === basename(process.argv[1]) &&
    resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const pr = Number(process.env.PR_NUMBER);
  if (!Number.isSafeInteger(pr)) throw new Error("PR_CERTIFICATION_INVALID_PR");
  runPrCertification(pr, process.env.SOURCE_SHA ?? "");
}
