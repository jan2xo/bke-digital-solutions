import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const activeDir = ".github/workflows";
const legacyDir = ".github/legacy-workflows/2026-10-02";

const expectedActive = [
  "certify.yml",
  "ci.yml",
  "deploy-web-code-only.yml",
  "live-paymongo-cutover.yml",
  "native-bke-account-handoff.yml",
  "probe-paymongo-test.yml",
  "preproduction-prisma.yml",
  "v2-accounts.yml",
  "v2-agent-store.yml",
  "v2-backups.yml",
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
].sort();

function triggerSection(source: string): string {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === "on:");
  expect(start).toBeGreaterThanOrEqual(0);
  const body = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/u.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

describe("intentional GitHub Actions architecture", () => {
  it("keeps only the declared certification surface active", () => {
    const active = readdirSync(activeDir)
      .filter((name) => name.endsWith(".yml"))
      .sort();
    expect(active).toEqual(expectedActive);
    expect(active).not.toContain("pr-guard.yml");
  });

  it("keeps named reusable certification jobs for every permitted owner", () => {
    const source = readFileSync(join(activeDir, "certify.yml"), "utf8");
    const owners = [
      "pr", "core", "accounts", "agent-store", "backups", "catalog",
      "commerce", "composition", "echo", "entitlements", "host",
      "identity", "legal", "licensing", "notifications", "payments",
      "platform", "prisma-isolation", "standalone", "native-account",
      "required-certification",
    ];
    for (const owner of owners) {
      expect(source, owner).toMatch(new RegExp("^  " + owner + ":$", "m"));
    }
  });

  it("has no automatic pull-request or ordinary push certification", () => {
    for (const name of expectedActive) {
      const source = readFileSync(join(activeDir, name), "utf8");
      const triggers = triggerSection(source);
      expect(triggers, name).not.toMatch(/^\s{2}pull_request:/mu);
      expect(triggers, name).not.toMatch(/^\s{2}push:/mu);
    }
  });

  it("retains an explicit certification entrypoint and callable modules", () => {
    const certify = readFileSync(join(activeDir, "certify.yml"), "utf8");
    const certifyTriggers = triggerSection(certify);
    expect(certifyTriggers).toMatch(/^\s{2}issue_comment:/mu);
    expect(certifyTriggers).toMatch(/^\s{2}workflow_dispatch:/mu);

    for (const name of expectedActive.filter((value) =>
      value !== "certify.yml" && value !== "deploy-web-code-only.yml")) {
      const triggers = triggerSection(
        readFileSync(join(activeDir, name), "utf8"),
      );
      expect(
        /^(?:\s{2}workflow_call:|\s{2}workflow_dispatch:)/mu.test(triggers),
        name,
      ).toBe(true);
    }
  });

  it("isolates protected web deployment from PR/push and heavy certification triggers", () => {
    const release = readFileSync(join(activeDir, "deploy-web-code-only.yml"), "utf8");
    const triggers = triggerSection(release);
    expect(triggers).toMatch(/^\s{2}issue_comment:/mu);
    expect(triggers).not.toMatch(/^\s{2}(?:workflow_dispatch|workflow_call|pull_request|push):/mu);
    expect(release).toContain("context.actor !== owner");
    expect(release).toContain("pr.merge_commit_sha !== source");
    expect(release).toContain("candidate.data.tree.sha !== merged.data.tree.sha");
    expect(release).toContain('name: Production');
    expect(release).not.toContain("npm run db:deploy");
  });

  it("keeps the PayMongo TEST probe owner-only, protected and outside production authority", () => {
    const source = readFileSync(join(activeDir, "probe-paymongo-test.yml"), "utf8");
    const triggers = triggerSection(source);
    expect(triggers).toMatch(/^\s{2}issue_comment:/mu);
    expect(triggers).toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(source).toContain("github.event.issue.number == 316");
    expect(source).toContain("context.actor !== owner");
    expect(source).toContain("github.event.comment.body == '/probe-paymongo-test'");
    expect(source).toContain("context.sha !== sha");
    expect(source).toContain("name: Production");
    expect(source).toContain("INFISICAL_PRODUCTION_IDENTITY_ID");
    expect(source).toContain("INFISICAL_PRODUCTION_PROJECT_ID");
    expect(source).toContain("node scripts/probe-paymongo-infisical.mjs --checkout");
    expect(source).toContain('id-token: write');
    expect(source).toContain("node --test scripts/probe-paymongo-test.test.mjs");
    expect(source).not.toContain("uses: Infisical/secrets-action@");
    expect(source).not.toContain("PAYMONGO_SECRET_KEY:");
    const reader = readFileSync("scripts/probe-paymongo-infisical.mjs", "utf8");
    expect(reader).toContain('"/api/v4/secrets/"');
    expect(reader).toContain('"PAYMONGO_TEST_MODE_SECRET_KEY"');
    expect(reader).toContain('"PAYMONGO_TEST_MODE_WEBHOOK_KEY"');
    expect(reader).not.toContain('"PAYMONGO_SECRET_KEY"');
    expect(reader).not.toContain('"PAYMONGO_WEBHOOK_SECRET"');
    expect(reader).toContain('PAYMONGO_LIVEMODE: "false"');
    expect(source).not.toContain("deploy_live");
  });

  it("keeps official preproduction migrations owner-dispatched and separated from protected Production", () => {
    const source = readFileSync(join(activeDir, "preproduction-prisma.yml"), "utf8");
    const triggers = triggerSection(source);
    expect(triggers).toMatch(/^\s{2}workflow_dispatch:/mu);
    expect(triggers).toMatch(/^\s{2}issue_comment:/mu);
    expect(triggers).not.toMatch(/^\s{2}(?:push|pull_request|workflow_call):/mu);
    expect(source).toContain("github.event.issue.number == 378");
    expect(source).toContain("github.actor == github.repository_owner");
    expect(source).toContain("PREPRODUCTION_PRISMA_DENIED_OWNER_COMMENT_REQUIRED");
    expect(source).toContain("github.actor == github.repository_owner");
    expect(source).toContain("environment:\\n      name: Preproduction".replace("\\n", "\n"));
    expect(source).toContain("INFISICAL_PREPRODUCTION_IDENTITY_ID");
    expect(source).toContain("env-slug: dev");
    expect(source).toContain("secret-path: /");
    expect(source).toContain("secret-name: DIRECT_DATABASE_URL");
    expect(source).toContain('include-imports: "false"');
    expect(source).toContain('recursive: "false"');
    expect(source).toContain("preproduction-prisma-operator.mjs preflight");
    expect(source).toContain("PREPRODUCTION_PRISMA_DENIED_SOURCE_MOVED_BEFORE_WRITE");
    expect(source).not.toContain("name: Production");
    expect(source).not.toContain("wrangler deploy");
  });

  it("preserves the complete pre-overhaul workflow archive", () => {
    const legacy = readdirSync(legacyDir)
      .filter((name) => name.endsWith(".yml"))
      .sort();
    expect(legacy).toHaveLength(20);
    expect(legacy).toContain("pr-guard.yml");
    expect(
      readFileSync(join(legacyDir, "README.md"), "utf8"),
    ).toContain("inert");
  });
});
