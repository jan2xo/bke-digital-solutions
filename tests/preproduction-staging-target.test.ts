import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepare } from "../scripts/deploy-staging.mjs";
import {
  proposed, assertIndependentPreproductionIdentity,
  buildPreproductionWorkerCandidate,
  type PreproductionTarget,
} from "../scripts/preproduction-staging-target.mjs";

const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as Record<string, any>;
const valid: PreproductionTarget = {
  worker: proposed.worker,
  origin: proposed.origin,
  neonProjectId: "fresh-project-12345678",
  neonBranchId: "br-new-clean-database",
  neonParentBranchId: null,
  database: proposed.database,
  databaseRole: proposed.databaseRole,
  neonDirectHost: "ep-fresh-preproduction.c-3.ap-southeast-1.aws.neon.tech",
  hyperdriveId: "a".repeat(32),
  redisPrefix: proposed.namespace,
};
const clone = () => structuredClone(valid);

describe("preproduction target isolation — source-only", () => {
  it("retired historical staging CLI refuses manifest preparation before any write", async () => {
    await expect(prepare("a".repeat(32))).rejects.toThrow(/LEGACY_STAGING_TARGET_RETIRED/);
  });

  it("requires an entirely new Neon project root, independent Worker, database, origin and Hyperdrive", () => {
    expect(assertIndependentPreproductionIdentity(valid)).toBe(true);
    const cases: Array<[keyof PreproductionTarget, string | null]> = [
      ["worker", "bke-digital-solutions"],
      ["worker", "bke-digital-solutions-try"],
      ["origin", "https://bkedigitalsolutions.com"],
      ["origin", "https://preproduction.bkedigitalsolutions.com.evil.test"],
      ["origin", "https://bke-digital-solutions.workers.dev"],
      ["origin", "http://preproduction.bkedigitalsolutions.com"],
      ["neonProjectId", "lingering-pond-33730332"],
      ["neonProjectId", "bold-hat-55602908"],
      ["neonBranchId", "br-hidden-shape-az7g4y2f"],
      ["neonBranchId", "br-soft-dawn-az9q94rd"],
      ["neonParentBranchId", "br-autumn-morning-az7buyxu"],
      ["database", "bke_production"],
      ["database", "bke_staging"],
      ["databaseRole", "bke_production_owner"],
      ["neonDirectHost", "ep-raspy-bread-azsc0112.c-3.ap-southeast-1.aws.neon.tech"],
      ["neonDirectHost", "ep-staging-pooler.c-3.ap-southeast-1.aws.neon.tech"],
      ["neonDirectHost", "ep-fake.attacker.test"],
      ["hyperdriveId", "ea1691c683e64bd0b9acc3489ab7759c"],
      ["hyperdriveId", "0".repeat(32)],
      ["redisPrefix", "bke-production"],
    ];
    for (const [key, value] of cases) {
      const invalid = clone();
      (invalid as Record<string, unknown>)[key] = value;
      expect(() => assertIndependentPreproductionIdentity(invalid), key).toThrow(/PREPRODUCTION_TARGET_DENIED/);
    }
  });

  it("emits a non-deploying candidate that cannot address production Worker, service, route, or Hyperdrive", () => {
    const candidate = buildPreproductionWorkerCandidate(source, clone());
    expect(candidate.name).toBe(proposed.worker);
    expect(candidate.workers_dev).toBe(false);
    expect(candidate.preview_urls).toBe(false);
    expect(candidate).not.toHaveProperty("route");
    expect(candidate).not.toHaveProperty("routes");
    expect(candidate).not.toHaveProperty("env");
    expect(candidate).not.toHaveProperty("triggers");
    expect(candidate).not.toHaveProperty("send_email");
    expect(candidate.services).toEqual([{ binding: "WORKER_SELF_REFERENCE", service: proposed.worker }]);
    expect(candidate.hyperdrive).toEqual([{ binding: "HYPERDRIVE_FRESH", id: valid.hyperdriveId }]);
    expect(candidate.vars.APP_URL).toBe(proposed.origin);
    expect(candidate.vars.DEPLOYMENT_ENV).toBe("staging");
    expect(candidate.vars.DEPLOYMENT_ID).toBe(proposed.namespace);
    expect(candidate.vars.REDIS_KEY_PREFIX).toBe(proposed.namespace);
    expect(candidate.vars.PAYMENT_PROVIDER).toBe("mock");
    expect(candidate.vars.PAYMONGO_LIVEMODE).toBe("false");
    expect(candidate.vars.EMAIL_PROVIDER).toBe("log");
    for (const name of [
      "CLAIM_CODE_CHECKOUT_ENABLED", "AGENT_ACCOUNT_SESSION_ENABLED",
      "STANDALONE_STARTUP_POLICY_HTTP_ENABLED", "STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED",
      "BACKUP_ENABLED",
    ]) expect(candidate.vars[name]).toBe("false");
    expect(candidate.vars).not.toHaveProperty("DATABASE_URL");
    expect(candidate.vars).not.toHaveProperty("DIRECT_DATABASE_URL");
    expect(candidate.vars).not.toHaveProperty("PAYMONGO_SECRET_KEY");
    expect(candidate.vars).not.toHaveProperty("ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON");
    expect(candidate.observability).toMatchObject({
      enabled: true, redact_query_string: true, logs: { enabled: true },
    });
    expect(source.name).toBe("bke-digital-solutions");
    expect(source.services[0].service).toBe("bke-digital-solutions");
  });

  it("rejects injected source production routes, worker URLs, cron, named env, credential variables and extra capabilities", () => {
    const mutations: Array<[string, (copy: Record<string, any>) => void]> = [
      ["apex route", c => { c.routes = [{ pattern: "bkedigitalsolutions.com", custom_domain: true }]; }],
      ["unspecified route", c => { c.route = "*"; }],
      ["named environment", c => { c.env = { staging: {} }; }],
      ["cron", c => { c.triggers = { crons: ["* * * * *"] }; }],
      ["injected vars", c => { c.vars.DATABASE_URL = "postgresql://secret"; }],
      ["worker URL", c => { c.workers_dev = true; }],
      ["preview URL", c => { c.preview_urls = true; }],
      ["wrong Worker", c => { c.name = "other-worker"; }],
      ["wrong self reference", c => { c.services[0].service = "other"; }],
      ["wrong Hyperdrive binding", c => { c.hyperdrive[0].binding = "PRODUCTION_DATABASE"; }],
      ["extra email", c => { c.send_email.push({ name: "SMTP" }); }],
      ["unredacted logs", c => { c.observability.redact_query_string = false; }],
      ["unknown destination setting", c => { c.zone_id = "prod-zone"; }],
    ];
    for (const [reason, mutate] of mutations) {
      const copy = structuredClone(source);
      mutate(copy);
      expect(() => buildPreproductionWorkerCandidate(copy, clone()), reason)
        .toThrow(/PREPRODUCTION_TARGET_DENIED/);
    }
  });

  it("does not mutate source and refuses invalid identity before generating any candidate", () => {
    const snapshot = structuredClone(source);
    buildPreproductionWorkerCandidate(source, clone());
    expect(source).toEqual(snapshot);
    expect(() => buildPreproductionWorkerCandidate(source, {
      ...valid, neonProjectId: "bold-hat-55602908",
    })).toThrow(/PREPRODUCTION_TARGET_DENIED/);
  });
});
