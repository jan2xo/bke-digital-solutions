import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  proposed, buildPreproductionWorkerCandidate,
} from "../scripts/preproduction-staging-target.mjs";
import {
  assertLiveCloudflareSnapshot, assertProtectedRouteReadiness,
  assertOperatorContext, prepareOperator,
} from "../scripts/preproduction-worker-operator.mjs";
import type { CloudflareRequest } from "../scripts/preproduction-worker-operator.mjs";

const sha = "a".repeat(40);
const workerTag = "f".repeat(32);
const operator = "jan2xpagauisan@gmail.com";
const originHost = new URL(proposed.origin).hostname;
const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
const account = [{ id: proposed.cloudflareAccountId }];
const drive = {
  id: proposed.hyperdriveId,
  name: proposed.worker,
  origin: {
    host: proposed.neonDirectHost, database: proposed.database,
    user: proposed.databaseRole, port: 5432, scheme: "postgres",
  },
  caching: { disabled: true },
  mtls: { sslmode: "require" },
  origin_connection_limit: 10,
};
const workers = [
  { id: "bke-air-stack-site" },
  { id: proposed.worker, tag: workerTag, routes: [] },
];
const live = assertLiveCloudflareSnapshot({
  accounts: account, drive, workers,
}, "activate_access_route");
const candidate = buildPreproductionWorkerCandidate(source, live, sha);
const secrets = [
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET",
  "LICENSE_PEPPER", "CRON_SECRET", "LICENSE_SIGNING_PRIVATE_KEY",
  "LICENSE_SIGNING_PUBLIC_KEY", "LICENSE_SIGNING_KEY_ID",
  "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
  "EMAIL_FROM", "SUPPORT_EMAIL",
];
const bindingSnapshot = {
  bindings: [
    ...Object.entries(candidate.vars).map(([name, text]) =>
      ({ name, type: "plain_text", text })),
    { name: "HYPERDRIVE_FRESH", type: "hyperdrive", id: proposed.hyperdriveId },
    { name: "WORKER_SELF_REFERENCE", type: "service", service: proposed.worker },
    ...secrets.map(name => ({ name, type: "secret_text" })),
  ],
};
const operatorOnlyPolicy = () => ({
  decision: "allow",
  include: [{ email: { email: operator } }],
  require: [],
  exclude: [],
});
const accessSnapshot = {
  worker: {
    id: "access-for-isolated-worker",
    name: "BKE DS preproduction Worker private",
    type: "self_hosted",
    destinations: [{ type: "worker", worker_id: workerTag }],
    policies: [operatorOnlyPolicy()],
  },
  hostname: {
    id: "9d93b63b-f7ba-43ae-9f87-f17af0803e02",
    name: "BKE Digital Solutions PREPRODUCTION",
    type: "self_hosted",
    domain: originHost,
    destinations: [{ type: "public", uri: originHost }],
    policies: [operatorOnlyPolicy()],
  },
};
const clone = <T,>(value: T): T => structuredClone(value);
const snapshot = () => ({
  live: clone(live),
  settings: clone(bindingSnapshot),
  route: { enabled: false, previews_enabled: false },
  apps: [clone(accessSnapshot.worker), clone(accessSnapshot.hostname)],
  subdomain: { subdomain: "jan2xpagauisan" },
});

describe("two-step isolated Worker HTTPS exposure", () => {
  it("keeps private upload inaccessible and pins a separate workers.dev test origin", () => {
    expect(proposed.origin).toBe(
      "https://bke-digital-solutions-preproduction.jan2xpagauisan.workers.dev");
    expect(candidate.name).toBe(proposed.worker);
    expect(candidate.workers_dev).toBe(false);
    expect(candidate.preview_urls).toBe(false);
    expect(candidate).not.toHaveProperty("routes");
    expect(candidate.vars.SOURCE_COMMIT_SHA).toBe(sha);
    expect(candidate.vars.DEPLOYMENT_ENV).toBe("staging");
    expect(candidate.vars.PAYMENT_PROVIDER).toBe("mock");
    expect(candidate.vars.STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED).toBe("false");
  });

  it("requires real existing named Worker and its immutable tag for activation", () => {
    expect(live.workerTag).toBe(workerTag);
    expect(() => assertLiveCloudflareSnapshot({ accounts: account, drive,
      workers: workers.slice(0, 1) }, "activate_access_route")).toThrow();
    expect(() => assertLiveCloudflareSnapshot({ accounts: account, drive,
      workers: [...workers, workers[1]] }, "activate_access_route")).toThrow();
    expect(() => assertLiveCloudflareSnapshot({ accounts: account, drive,
      workers }, "deploy")).toThrow();
  });

  it("accepts only exact source, isolated bindings and Worker-level AND hostname Access", () => {
    expect(assertProtectedRouteReadiness(snapshot(), candidate, operator)).toBe(true);
    const invalidCases: Array<(x: ReturnType<typeof snapshot>) => void> = [
      x => { x.apps = [clone(accessSnapshot.hostname)]; }, // hostname alone has version URL bypass
      x => { x.apps[0].destinations[0].type = "preview_worker"; },
      x => { x.apps[0].destinations[0].worker_id = "b".repeat(32); },
      x => { x.apps[0].policies[0].decision = "bypass"; },
      x => { x.apps[0].policies[0].include = [{ everyone: {} }]; },
      x => { x.apps[0].policies.push(operatorOnlyPolicy()); },
      x => { x.apps[0].destinations[0].overrides = [{ behavior: "public", path_pattern: "/*" }]; },
      x => { x.apps[1].policies[0].decision = "bypass"; },
      x => { x.apps[1].destinations[0].uri = "bkedigitalsolutions.com"; },
      x => { x.route.enabled = true; }, // no unattended update / reactivation
      x => { x.route.previews_enabled = true; },
      x => { x.subdomain.subdomain = "wrong-account"; },
      x => { x.settings.bindings.find(b => b.name === "SOURCE_COMMIT_SHA")!.text = "b".repeat(40); },
      x => { x.settings.bindings.find(b => b.name === "APP_URL")!.text = "https://bkedigitalsolutions.com"; },
      x => { x.settings.bindings.find(b => b.name === "PAYMENT_PROVIDER")!.text = "paymongo"; },
      x => { x.settings.bindings.find(b => b.name === "HYPERDRIVE_FRESH")!.id = "ea1691c683e64bd0b9acc3489ab7759c"; },
      x => { x.settings.bindings.push({ name: "PAYMONGO_SECRET_KEY", type: "secret_text" }); },
      x => { x.settings.bindings = x.settings.bindings.filter(b => b.name !== "SESSION_SECRET"); },
    ];
    for (const [i, mutate] of invalidCases.entries()) {
      const wrong = snapshot();
      mutate(wrong);
      expect(() => assertProtectedRouteReadiness(wrong, candidate, operator), "case " + i)
        .toThrow(/PREPRODUCTION_WORKER_DENIED/);
    }
    expect(() => assertProtectedRouteReadiness(snapshot(), candidate,
      "attacker@example.com")).toThrow(/PREPRODUCTION_WORKER_DENIED/);
  });

  it("requires owner exact-main and mode-specific activation confirmation", () => {
    const ctx = {
      GITHUB_REPOSITORY: "jan2xo/bke-digital-solutions",
      GITHUB_ACTOR: "jan2xo",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sha,
      GITHUB_WORKFLOW_SHA: sha,
      GITHUB_WORKFLOW_REF:
        "jan2xo/bke-digital-solutions/.github/workflows/preproduction-worker.yml@refs/heads/main",
      SOURCE_SHA: sha,
      PREPRODUCTION_WORKER_MODE: "activate_access_route",
      PREPRODUCTION_WORKER_CONFIRMATION: "ACTIVATE_ACCESS_PROTECTED_PREPRODUCTION_ROUTE",
    };
    expect(assertOperatorContext(ctx)).toBe("activate_access_route");
    expect(() => assertOperatorContext({
      ...ctx, PREPRODUCTION_WORKER_CONFIRMATION: "DEPLOY_ISOLATED_BKE_PREPRODUCTION_WORKER",
    })).toThrow();
  });

  it("performs no public route write until two complete live control-plane reads pass", async () => {
    const env = {
      GITHUB_REPOSITORY: "jan2xo/bke-digital-solutions",
      GITHUB_ACTOR: "jan2xo",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: sha,
      GITHUB_WORKFLOW_SHA: sha,
      GITHUB_WORKFLOW_REF:
        "jan2xo/bke-digital-solutions/.github/workflows/preproduction-worker.yml@refs/heads/main",
      SOURCE_SHA: sha,
      PREPRODUCTION_WORKER_MODE: "activate_access_route",
      PREPRODUCTION_WORKER_CONFIRMATION: "ACTIVATE_ACCESS_PROTECTED_PREPRODUCTION_ROUTE",
      PREPRODUCTION_WORKER_ACCESS_OPERATOR_EMAIL: operator,
      CLOUDFLARE_API_TOKEN: "x".repeat(45),
    };
    let routeEnabled = false;
    const calls: Array<{ path: string; method: string }> = [];
    const responder = async (url: string, options: CloudflareRequest) => {
      const path = new URL(url).pathname;
      const method = options.method ?? "GET";
      calls.push({ path, method });
      let result: unknown;
      if (method === "POST") {
        expect(path).toBe("/client/v4/accounts/" +
          proposed.cloudflareAccountId + "/workers/scripts/" + proposed.worker + "/subdomain");
        expect(options.body).toBe(JSON.stringify({
          enabled: true, previews_enabled: false,
        }));
        routeEnabled = true;
        result = { enabled: true, previews_enabled: false };
      } else if (path === "/client/v4/accounts") result = account;
      else if (path.endsWith("/hyperdrive/configs/" + proposed.hyperdriveId)) result = drive;
      else if (path.endsWith("/workers/scripts") && !path.endsWith("/settings")) result = workers;
      else if (path.endsWith("/workers/scripts/" + proposed.worker + "/settings")) result = bindingSnapshot;
      else if (path.endsWith("/workers/scripts/" + proposed.worker + "/subdomain"))
        result = { enabled: routeEnabled, previews_enabled: false };
      else if (path.endsWith("/access/apps")) result = [accessSnapshot.worker, accessSnapshot.hostname];
      else if (path.endsWith("/workers/subdomain")) result = { subdomain: "jan2xpagauisan" };
      else throw new Error("Unexpected request " + path);
      return { ok: true, json: async () => ({ success: true, result }) };
    };
    expect(await prepareOperator(env, responder)).toBe("activate_access_route");
    expect(calls.filter(c => c.method === "POST")).toHaveLength(1);
    expect(calls.filter(c => c.method === "GET")).toHaveLength(15);
    expect(calls.at(-1)?.method).toBe("GET"); // post-enable readback
    expect(routeEnabled).toBe(true);
  });
});
