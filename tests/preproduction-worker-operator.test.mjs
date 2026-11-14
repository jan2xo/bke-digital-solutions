import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { proposed } from "../scripts/preproduction-staging-target.mjs";
import {
  assertOperatorContext, assertLiveCloudflareSnapshot, assertRuntimeSecretBundle,
  assertDeploymentApprovals, readLiveCloudflare,
} from "../scripts/preproduction-worker-operator.mjs";

const sha = "a".repeat(40);
const context = {
  GITHUB_REPOSITORY: "jan2xo/bke-digital-solutions",
  GITHUB_ACTOR: "jan2xo",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  GITHUB_WORKFLOW_SHA: sha,
  GITHUB_WORKFLOW_REF:
    "jan2xo/bke-digital-solutions/.github/workflows/preproduction-worker.yml@refs/heads/main",
  SOURCE_SHA: sha,
  PREPRODUCTION_WORKER_MODE: "verify_only",
  PREPRODUCTION_WORKER_CONFIRMATION: "VERIFY_ISOLATED_BKE_PREPRODUCTION_WORKER",
};
const live = {
  accounts: [{ id: proposed.cloudflareAccountId }],
  drive: {
    id: proposed.hyperdriveId,
    name: proposed.worker,
    origin: {
      host: proposed.neonDirectHost, port: 5432, database: proposed.database,
      scheme: "postgres", user: proposed.databaseRole,
    },
    caching: { disabled: true },
    mtls: { sslmode: "require" },
    origin_connection_limit: 10,
  },
  workers: [
    { id: "bke-air-stack-site" }, { id: "bke-command-center-preproduction" },
    { id: "bke-skills-mcp" }, { id: "bke-worker-relay-preproduction" },
  ],
};
const clone = value => structuredClone(value);
const pair = generateKeyPairSync("ed25519");
const validSecrets = {
  GOOGLE_CLIENT_ID: "isolated-staging-client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "isolated-staging-client-secret",
  SESSION_SECRET: "s".repeat(60),
  LICENSE_PEPPER: "p".repeat(60),
  CRON_SECRET: "c".repeat(60),
  LICENSE_SIGNING_PRIVATE_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
  LICENSE_SIGNING_PUBLIC_KEY: pair.publicKey.export({ type: "spki", format: "pem" }),
  LICENSE_SIGNING_KEY_ID: "preproduction-ed25519-1",
  UPSTASH_REDIS_REST_URL: "https://staging-redis.upstash.io/",
  UPSTASH_REDIS_REST_TOKEN: "isolated-staging-redis-token",
  EMAIL_FROM: "no-reply@bkedigitalsolutions.com",
  SUPPORT_EMAIL: "support@bkedigitalsolutions.com",
};
const approved = {
  PREPRODUCTION_WORKER_APPROVED_ORIGIN: proposed.origin,
  PREPRODUCTION_WORKER_APPROVED_REDIS_ORIGIN: "https://staging-redis.upstash.io",
  PREPRODUCTION_WORKER_RUNTIME_CUSTODY: "ISOLATED_PREPRODUCTION_ONLY",
  PREPRODUCTION_WORKER_SIGNER_CUSTODY: "NONPRODUCTION_ED25519_ONLY",
};

describe("protected manual-only preproduction Worker operator", () => {
  it("accepts only exact merged main, owner, workflow ref and correct confirmation", () => {
    expect(assertOperatorContext(context)).toBe("verify_only");
    const deploy = {
      ...context, PREPRODUCTION_WORKER_MODE: "deploy",
      PREPRODUCTION_WORKER_CONFIRMATION: "DEPLOY_ISOLATED_BKE_PREPRODUCTION_WORKER",
    };
    expect(assertOperatorContext(deploy)).toBe("deploy");
    for (const [field, wrong] of [
      ["GITHUB_REPOSITORY", "jan2xo/other"],
      ["GITHUB_ACTOR", "other"],
      ["GITHUB_REF", "refs/heads/feature"],
      ["GITHUB_SHA", "b".repeat(40)],
      ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
      ["GITHUB_WORKFLOW_REF", "jan2xo/bke-digital-solutions/.github/workflows/ci.yml@refs/heads/main"],
      ["SOURCE_SHA", "b".repeat(40)],
      ["PREPRODUCTION_WORKER_MODE", "production"],
      ["PREPRODUCTION_WORKER_CONFIRMATION", "DEPLOY_ISOLATED_BKE_PREPRODUCTION_WORKER"],
    ]) {
      expect(() => assertOperatorContext({ ...context, [field]: wrong }), field)
        .toThrow(/PREPRODUCTION_WORKER_DENIED/);
    }
  });

  it("accepts only independently observed exact account / Hyperdrive / restricted role and no existing target", () => {
    const actual = assertLiveCloudflareSnapshot(clone(live));
    expect(actual.hyperdriveId).toBe(proposed.hyperdriveId);
    expect(actual.hyperdriveOriginRole).toBe(proposed.databaseRole);
    expect(actual.cloudflareAccountId).toBe(proposed.cloudflareAccountId);
    for (const corrupt of [
      x => { x.accounts = [{ id: "384c6c13373eb94a2925e0d865139970" }]; },
      x => { x.drive.id = "437f92c3b9a14489be6e3e7f21307821"; },
      x => { x.drive.origin.user = "bke_preproduction_owner"; },
      x => { x.drive.origin.database = "bke_production"; },
      x => { x.drive.origin.host = "ep-fake.attacker.test"; },
      x => { x.drive.origin.port = 5433; },
      x => { x.drive.caching.disabled = false; },
      x => { x.drive.mtls.sslmode = "disable"; },
      x => { x.drive.origin_connection_limit = 20; },
      x => { x.workers.push({ id: proposed.worker }); },
      x => { x.workers = null; },
    ]) {
      const invalid = clone(live);
      corrupt(invalid);
      expect(() => assertLiveCloudflareSnapshot(invalid)).toThrow(/PREPRODUCTION_WORKER_DENIED/);
    }
  });

  it("makes three fresh remote GETs, never trusts a caller-provided snapshot", async () => {
    const calls = [];
    const responses = [live.accounts, live.drive, live.workers];
    const fake = async (url, options) => {
      calls.push({ url, auth: options.headers.Authorization });
      const value = responses[calls.length - 1];
      return { ok: true, json: async () => ({ success: true, result: value }) };
    };
    expect((await readLiveCloudflare("x".repeat(40), fake)).databaseRole)
      .toBe(proposed.databaseRole);
    expect(calls).toHaveLength(3);
    expect(calls.every(call => call.url.startsWith("https://api.cloudflare.com/client/v4/accounts/") ||
      call.url.includes("/accounts?"))).toBe(true);
    expect(calls.every(call => call.auth === "Bearer " + "x".repeat(40))).toBe(true);
    await expect(readLiveCloudflare("bad", fake)).rejects.toThrow(/PREPRODUCTION_WORKER_DENIED/);
    const failing = async () => ({ ok: false });
    await expect(readLiveCloudflare("x".repeat(40), failing))
      .rejects.toThrow(/PREPRODUCTION_WORKER_DENIED/);
  });

  it("accepts only explicitly isolated runtime keys and matching Ed25519 signer pair", () => {
    expect(assertRuntimeSecretBundle(JSON.stringify(validSecrets),
      approved.PREPRODUCTION_WORKER_APPROVED_REDIS_ORIGIN).SESSION_SECRET)
      .toBe(validSecrets.SESSION_SECRET);
    expect(() => assertDeploymentApprovals(approved, JSON.stringify(validSecrets)))
      .not.toThrow();
    for (const mutate of [
      x => { x.DATABASE_URL = "postgresql://prod:password@db/prod"; },
      x => { x.PAYMONGO_SECRET_KEY = "sk_live_disallowed"; },
      x => { delete x.SESSION_SECRET; },
      x => { x.SESSION_SECRET = "replace-me"; },
      x => { x.LICENSE_SIGNING_KEY_ID = "production-signing"; },
      x => { x.UPSTASH_REDIS_REST_URL = "https://production-redis.upstash.io/"; },
      x => { x.UPSTASH_REDIS_REST_URL = "http://staging-redis.upstash.io/"; },
      x => { x.LICENSE_SIGNING_PUBLIC_KEY =
        generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }); },
    ]) {
      const invalid = clone(validSecrets);
      mutate(invalid);
      expect(() => assertRuntimeSecretBundle(JSON.stringify(invalid),
        approved.PREPRODUCTION_WORKER_APPROVED_REDIS_ORIGIN))
        .toThrow(/PREPRODUCTION_WORKER_DENIED/);
    }
    for (const field of Object.keys(approved)) {
      expect(() => assertDeploymentApprovals({ ...approved, [field]: "WRONG" },
        JSON.stringify(validSecrets))).toThrow(/PREPRODUCTION_WORKER_DENIED/);
    }
  });

  it("workflow is manual-only, protected, exact-main, and cannot call production or database migration", () => {
    const workflow = readFileSync(".github/workflows/preproduction-worker.yml", "utf8");
    expect(workflow).toMatch(/workflow_dispatch:/);
    expect(workflow).toMatch(/environment:\s*\n\s*name: Preproduction-Worker/);
    expect(workflow).toMatch(/github\.actor == github\.repository_owner/);
    expect(workflow).toMatch(/main\.data\.object\.sha !== exact/);
    expect(workflow).toMatch(/--secrets-file/);
    expect(workflow).toMatch(/--config \.wrangler-preproduction\.json/);
    expect(workflow).not.toMatch(/^\s+(pull_request|push|schedule|issue_comment):/m);
    expect(workflow).not.toMatch(/prisma migrate deploy|npm run db:deploy|deploy-production\.sh/);
  });
});
