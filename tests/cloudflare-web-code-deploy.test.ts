import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  target, buildProductionConfig, bindingFingerprint, assertHyperdrive,
} from "../scripts/deploy-web-code-only.mjs";

const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const workflow = readFileSync(".github/workflows/deploy-web-code-only.yml", "utf8");

const binding = (name: string, type: string, fields: Record<string, string> = {}) =>
  ({ name, type, ...fields });
const fixed = [
  binding("ASSETS", "assets"),
  binding("WORKER_SELF_REFERENCE", "service", { service: "bke-digital-solutions" }),
  binding("HYPERDRIVE_FRESH", "hyperdrive", { id: target.hyperdriveId }),
  binding("EMAIL", "send_email"),
  binding("SESSION_SECRET", "secret_text"),
  binding("GOOGLE_CLIENT_SECRET", "secret_text"),
  binding("GOOGLE_CLIENT_ID", "plain_text", { text: "test-client" }),
  binding("UPSTASH_REDIS_REST_TOKEN", "secret_text"),
  binding("UPSTASH_REDIS_REST_URL", "secret_text"),
  binding("APP_URL", "plain_text", { text: target.appUrl }),
  binding("DEPLOYMENT_ENV", "plain_text", { text: "production" }),
  binding("DEPLOYMENT_ID", "plain_text", { text: target.deploymentId }),
  binding("NODE_ENV", "plain_text", { text: "production" }),
  binding("BKE_RUNTIME", "plain_text", { text: "workers" }),
];

describe("protected code-only Cloudflare release", () => {
  it("preserves dashboard vars and existing runtime bindings, pins real Hyperdrive", () => {
    const original = structuredClone(source);
    const config = buildProductionConfig(source);
    expect(config.name).toBe("bke-digital-solutions");
    expect(config.main).toBe("workers/entry.ts");
    expect(config.workers_dev).toBe(false);
    expect(config).not.toHaveProperty("keep_vars");
    expect(workflow).toContain("--keep-vars");
    expect(config.hyperdrive[0]).toEqual({
      binding: "HYPERDRIVE_FRESH", id: target.hyperdriveId,
    });
    expect(config.hyperdrive[0].localConnectionString).toBeUndefined();
    expect(config.services[0]).toEqual(original.services[0]);
    expect(config.send_email[0]).toEqual(original.send_email[0]);
    expect(config.vars).toEqual({ BKE_RUNTIME: "workers" });
    expect(config.routes).toBeUndefined();
    expect(source).toEqual(original);
    expect(original.hyperdrive[0].id).toMatch(/^0{32}$/);
  });

  it("rejects altered route, cron, environment, email or backend authority", () => {
    for (const patch of [
      { routes: [{ pattern: "other.example.com", custom_domain: true }] },
      { env: { production: {} } },
      { triggers: { crons: ["* * * * *"] } },
      { send_email: [] },
      { hyperdrive: [{ binding: "HYPERDRIVE_FRESH", id: "incorrect" }] },
      { services: [] },
    ]) {
      expect(() => buildProductionConfig({ ...structuredClone(source), ...patch })).toThrow();
    }
  });

  it("requires production account, domain, TLS-backed Neon and no Hyperdrive cache", () => {
    expect(assertHyperdrive({
      id: target.hyperdriveId, name: target.hyperdriveName,
      origin: {database: target.database, host: target.neonHost,
        user: target.databaseUser, port: 5432, scheme: "postgres"},
      caching: {disabled: true},
    })).toBe(true);
    for (const changed of [
      { id: "00000000000000000000000000000000" },
      { name: "bke-digital-solutions-staging-fresh" },
      { origin: {database: "bke_staging", host: "bad.example",
        user: "bke_staging_owner", port: 5432, scheme: "postgres"} },
      { caching: {disabled: false} },
    ]) {
      const base = { id: target.hyperdriveId, name: target.hyperdriveName,
        origin: {database: target.database, host: target.neonHost,
          user: target.databaseUser, port: 5432, scheme: "postgres"},
        caching: {disabled: true} };
      expect(() => assertHyperdrive({ ...base, ...changed })).toThrow();
    }
  });

  it("fingerprints ALL existing bindings, rejects mutation, but never hashes secret values", () => {
    const digest = bindingFingerprint(fixed);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(bindingFingerprint([...fixed].reverse())).toBe(digest);
    expect(() => bindingFingerprint(fixed.filter((x) => x.name !== "SESSION_SECRET"))).toThrow();
    expect(() => bindingFingerprint([...fixed, fixed[0]])).toThrow();
    expect(() => bindingFingerprint(fixed.map((x) => x.name === "APP_URL"
      ? { ...x, text: "https://evil.example" } : x))).toThrow();
    expect(() => bindingFingerprint(fixed.map((x) => x.name === "HYPERDRIVE_FRESH"
      ? { ...x, id: "wrong" } : x))).toThrow();
    expect(bindingFingerprint([...fixed, binding("OPTIONAL", "secret_text")])).not.toBe(digest);
  });

  it("trusts only an owner comment after merged exact-main proof, never PR push", () => {
    expect(workflow).toMatch(/on:\n  issue_comment:\n    types: \[created\]/);
    expect(workflow).not.toMatch(/\n  (?:push|pull_request|workflow_dispatch):/);
    expect(workflow).toContain("context.actor !== owner");
    expect(workflow).toContain("pr.merge_commit_sha !== source");
    expect(workflow).toContain("candidate.data.tree.sha !== merged.data.tree.sha");
    expect(workflow).toContain("run.event !== \"issue_comment\"");
    expect(workflow).toContain("Required certification PASS for ");
    expect(workflow).toContain('name: Production');
    expect(workflow).toContain("CODE_ONLY_PRODUCTION_RELEASE");
    expect(workflow).toContain("--keep-vars");
    expect(workflow).toContain("wrangler rollback");
    expect(workflow).toContain("if: ${{ env.RELEASE_MODE == 'deploy' }}");
    expect(workflow).not.toContain("npm run db:deploy");
    expect(workflow).not.toContain("PAYMONGO_SECRET_KEY");
    expect(workflow).not.toContain("RESEND_API_KEY");
    expect(workflow).not.toContain("Infisical/");
  });
});
