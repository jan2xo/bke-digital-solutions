import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  pinned, validateOperatorContext, verifySqlIdentity,
  verifyMigrationLedger, readSourceMigrations,
  type OperatorEnv, type SqlIdentity,
} from "../scripts/preproduction-prisma-operator.mjs";

const direct = "postgresql://" + pinned.role + ":fake-password@" + pinned.computeHost +
  ":5432/" + pinned.database + "?sslmode=require&channel_binding=require";
function eligible(): OperatorEnv {
  const sha = "a".repeat(40);
  return {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: pinned.repository,
    GITHUB_ACTOR: pinned.actor, GITHUB_SHA: sha, SOURCE_SHA: sha,
    NODE_ENV: "production", DEPLOYMENT_ENV: "staging",
    PREPRODUCTION_NEON_PROJECT_ID: pinned.projectId,
    PREPRODUCTION_NEON_BRANCH_ID: pinned.branchId,
    PREPRODUCTION_NEON_HOST: pinned.computeHost,
    PREPRODUCTION_DATABASE_NAME: pinned.database,
    PREPRODUCTION_MIGRATION_MODE: "apply_official_migrations",
    PREPRODUCTION_MIGRATION_CONFIRMATION: "APPLY_OFFICIAL_PRISMA_TO_FRESH_BKE_PREPRODUCTION",
    DIRECT_DATABASE_URL: direct,
  };
}
function identity(): SqlIdentity {
  return { database: pinned.database, db_role: pinned.role, mock_schemas: 0,
    unapproved_schemas: 0, public_tables: 0, prisma_ledger: null };
}
describe("official preproduction Prisma operator — source-only denial proof", () => {
  it("accepts only exact-main owner and dedicated nonproduction target", () => {
    const good = validateOperatorContext(eligible(), "preflight");
    expect(good.url.hostname).toBe(pinned.computeHost);
    expect(good.url.pathname).toBe("/bke_preproduction");
    const cases = [
      ["GITHUB_ACTIONS", "false"], ["GITHUB_EVENT_NAME", "pull_request"],
      ["GITHUB_REF", "refs/heads/feature"], ["GITHUB_ACTOR", "collaborator"],
      ["GITHUB_REPOSITORY", "other/repo"], ["GITHUB_SHA", "b".repeat(40)],
      ["NODE_ENV", "test"], ["DEPLOYMENT_ENV", "production"],
      ["PREPRODUCTION_NEON_PROJECT_ID", "lingering-pond-33730332"],
      ["PREPRODUCTION_NEON_PROJECT_ID", "bold-hat-55602908"],
      ["PREPRODUCTION_NEON_BRANCH_ID", "br-hidden-shape-az7g4y2f"],
      ["PREPRODUCTION_DATABASE_NAME", "bke_production"],
      ["PREPRODUCTION_NEON_HOST", "ep-raspy-bread-azsc0112.c-3.ap-southeast-1.aws.neon.tech"],
      ["PREPRODUCTION_MIGRATION_CONFIRMATION", "ENABLE_PRODUCTION"],
      ["DIRECT_DATABASE_URL", "invalid"],
    ] as const;
    for (const [key, value] of cases) {
      expect(() => validateOperatorContext({ ...eligible(), [key]: value }, "preflight"), key)
        .toThrow(/PREPRODUCTION_PRISMA_DENIED_/);
    }
  });
  it("rejects wrong mode, confirmation, SQL env override and URL target/TLS manipulation", () => {
    const verifyOnly = eligible();
    verifyOnly.PREPRODUCTION_MIGRATION_MODE = "verify_only";
    verifyOnly.PREPRODUCTION_MIGRATION_CONFIRMATION = "VERIFY_OFFICIAL_PRISMA_BKE_PREPRODUCTION";
    expect(validateOperatorContext(verifyOnly, "verify").mode).toBe("verify_only");
    expect(() => validateOperatorContext(verifyOnly, "preflight")).toThrow(/OPERATOR_CONFIRMATION_REQUIRED/);
    expect(() => validateOperatorContext({ ...eligible(), PGHOST: "production" }, "preflight"))
      .toThrow(/PG_ENV_OVERRIDE_FORBIDDEN/);
    expect(() => validateOperatorContext({ ...eligible(), DATABASE_URL: direct + "&foo=bar" }, "preflight"))
      .toThrow(/DEDICATED_CREDENTIALS_REQUIRED/);
    const badUrls = [
      direct.replace(pinned.computeHost, "ep-raspy-bread-azsc0112.c-3.ap-southeast-1.aws.neon.tech"),
      direct.replace(pinned.computeHost, "ep-polished-glade-a1u174wx-pooler.ap-southeast-1.aws.neon.tech"),
      direct.replace(pinned.database, "bke_production"),
      direct.replace(pinned.role, "bke_production_owner"),
      direct.replace("sslmode=require", "sslmode=disable"),
      direct.replace("sslmode=require", "sslmode=prefer"),
      direct.replace("channel_binding=require", "channel_binding=disable"),
      direct + "&host=attacker.example",
      direct + "&sslmode=disable",
      direct + "&%68ost=other.neon.tech",
      direct.replace(":5432/", ":6543/"),
      direct.replace("postgresql:", "https:"),
    ];
    for (const url of badUrls) {
      expect(() => validateOperatorContext({ ...eligible(), DIRECT_DATABASE_URL: url }, "preflight"))
        .toThrow(/PREPRODUCTION_PRISMA_DENIED_/);
    }
  });
  it("rejects every retired issue_comment path, including the former owner-only route", () => {
    const oldRoute = eligible();
    oldRoute.GITHUB_EVENT_NAME = "issue_comment";
    oldRoute.GITHUB_EVENT_PATH = "/tmp/retired-owner-comment.json";
    expect(() => validateOperatorContext(oldRoute, "preflight"))
      .toThrow(/EXACT_MAIN_OWNER_REQUIRED/);
    expect(() => validateOperatorContext({
      ...oldRoute, GITHUB_ACTOR: "github-actions[bot]",
    }, "preflight")).toThrow(/EXACT_MAIN_OWNER_REQUIRED/);
  });

  it("does not demand a Neon management API credential to validate its pinned SQL target", () => {
    expect(validateOperatorContext({ ...eligible(), NEON_API_KEY: undefined }, "preflight").url.hostname)
      .toBe(pinned.computeHost);
    expect(validateOperatorContext({ ...eligible(), NEON_API_KEY: "" }, "preflight").url.hostname)
      .toBe(pinned.computeHost);
  });
  it("denies nonempty fresh database and incomplete migrated state", () => {
    expect(verifySqlIdentity(identity(), "preflight")).toBe(true);
    const cases: SqlIdentity[] = [
      { ...identity(), database: "bke_production" },
      { ...identity(), db_role: "bke_staging_owner" },
      { ...identity(), public_tables: 1 },
      { ...identity(), prisma_ledger: "_prisma_migrations" },
      { ...identity(), mock_schemas: 1 },
      { ...identity(), unapproved_schemas: 1 },
    ];
    for (const x of cases) expect(() => verifySqlIdentity(x, "preflight"))
      .toThrow(/PREPRODUCTION_PRISMA_DENIED_/);
    expect(() => verifySqlIdentity(identity(), "verify"))
      .toThrow(/OFFICIAL_PRISMA_SCHEMA_NOT_INSTALLED/);
    expect(verifySqlIdentity({
      ...identity(), public_tables: 80, prisma_ledger: "_prisma_migrations",
    }, "verify")).toBe(true);
  });
  it("validates official migration source and exact DB SHA-256 history", () => {
    const source = readSourceMigrations();
    expect(source.size).toBeGreaterThan(60);
    const small = new Map([...source].slice(0, 2));
    const rows = [...small].map(([migration_name, checksum]) => ({
      migration_name, checksum, finished_at: new Date(), rolled_back_at: null,
    }));
    expect(verifyMigrationLedger(small, rows).checksumVerified).toBe(true);
    expect(() => verifyMigrationLedger(small, [rows[0]!])).toThrow(/HISTORY_INCOMPLETE/);
    expect(() => verifyMigrationLedger(small, [rows[0]!, rows[0]!])).toThrow(/HISTORY_DIVERGED/);
    expect(() => verifyMigrationLedger(small,
      [{ ...rows[0]!, checksum: "0".repeat(64) }, rows[1]!])).toThrow(/HISTORY_DIVERGED/);
    expect(() => verifyMigrationLedger(small,
      [{ ...rows[0]!, rolled_back_at: new Date() }, rows[1]!])).toThrow(/HISTORY_DIVERGED/);
  });
  it("protects GitHub workflow: no automatic trigger, production secret, seed, or deployment", () => {
    const workflow = readFileSync(".github/workflows/preproduction-prisma.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toContain("issue_comment:");
    expect(workflow).not.toContain("github.event.issue.number == 378");
    expect(workflow).not.toContain("PREPRODUCTION_PRISMA_DENIED_OWNER_COMMENT_REQUIRED");
    expect(workflow).not.toMatch(/^  (issue_comment|pull_request|push|workflow_call):/m);
    expect(workflow).toContain('context.eventName !== "workflow_dispatch"');
    expect(workflow).toContain("environment:\n      name: Preproduction");
    expect(workflow).toContain("github.actor == github.repository_owner");
    expect(workflow).toContain('project !== "f029af60-06f3-428c-b305-c70f8bcf7850"');
    expect(workflow).toContain("env-slug: dev");
    expect(workflow).toContain("secret-path: /");
    expect(workflow).toContain("secret-name: DIRECT_DATABASE_URL");
    expect(workflow).toContain('include-imports: "false"');
    expect(workflow).toContain('recursive: "false"');
    expect(workflow).not.toContain("env-slug: prod");
    expect(workflow).not.toContain("env-slug: staging");
    expect(workflow).not.toContain("NEON_API_KEY");
    expect(workflow).toContain("include-imports: \"false\"");
    const packageInstall = workflow.indexOf("npm ci --include=dev");
    const infisicalLoad = workflow.indexOf("Load ONLY direct DB URL");
    const sqlPreflight = workflow.indexOf("preproduction-prisma-operator.mjs preflight");
    const prismaGenerate = workflow.indexOf("npm run db:generate");
    const officialDeploy = workflow.indexOf("npm run db:deploy");
    expect(packageInstall).toBeGreaterThan(0);
    expect(infisicalLoad).toBeGreaterThan(packageInstall);
    expect(sqlPreflight).toBeGreaterThan(infisicalLoad);
    expect(prismaGenerate).toBeGreaterThan(sqlPreflight);
    expect(officialDeploy).toBeGreaterThan(prismaGenerate);
    expect(workflow).toContain("npm run db:deploy");
    expect(workflow).toContain("npm run db:status");
    expect(workflow).toContain("preproduction-prisma-operator.mjs preflight");
    expect(workflow).toContain("preproduction-prisma-operator.mjs verify");
    for (const disallowed of ["env-slug: prod", "name: Production", "wrangler deploy",
      "db:seed", "PAYMONGO_SECRET_KEY", "PAYMONGO_WEBHOOK_SECRET"]) {
      expect(workflow).not.toContain(disallowed);
    }
  });
});
