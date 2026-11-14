// Protected, manual-only preproduction Worker operator.
// No CLI path except explicit GitHub main/owner dispatch may write or deploy.
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  proposed, assertIndependentPreproductionIdentity, buildPreproductionWorkerCandidate,
} from "./preproduction-staging-target.mjs";

const REPOSITORY = "jan2xo/bke-digital-solutions";
const WORKFLOW = REPOSITORY + "/.github/workflows/preproduction-worker.yml@refs/heads/main";
const REQUIRED_SECRETS = [
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET", "LICENSE_PEPPER",
  "CRON_SECRET", "LICENSE_SIGNING_PRIVATE_KEY", "LICENSE_SIGNING_PUBLIC_KEY",
  "LICENSE_SIGNING_KEY_ID", "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN", "EMAIL_FROM", "SUPPORT_EMAIL",
];
const allowedSecretNames = new Set(REQUIRED_SECRETS);
const CONFIRMATION = {
  verify_only: "VERIFY_ISOLATED_BKE_PREPRODUCTION_WORKER",
  deploy: "DEPLOY_ISOLATED_BKE_PREPRODUCTION_WORKER",
  activate_access_route: "ACTIVATE_ACCESS_PROTECTED_PREPRODUCTION_ROUTE",
};
function deny(reason) {
  throw new Error("PREPRODUCTION_WORKER_DENIED: " + reason);
}
export function assertOperatorContext(env) {
  const sha = env.SOURCE_SHA;
  const mode = env.PREPRODUCTION_WORKER_MODE;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") ||
      env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_ACTOR !== "jan2xo" ||
      env.GITHUB_REF !== "refs/heads/main" ||
      env.GITHUB_SHA !== sha || env.GITHUB_WORKFLOW_SHA !== sha ||
      env.GITHUB_WORKFLOW_REF !== WORKFLOW ||
      !Object.hasOwn(CONFIRMATION, mode ?? "") ||
      env.PREPRODUCTION_WORKER_CONFIRMATION !== CONFIRMATION[mode]) {
    deny("exact merged main, repository owner and mode-specific confirmation required");
  }
  return mode;
}
function isNonPlaceholder(value, minimum = 1) {
  return typeof value === "string" && value.length >= minimum &&
    !/(replace|change[-_ ]?me|example|placeholder|your[-_]|development-only)/i.test(value);
}
export function assertRuntimeSecretBundle(raw, approvedRedisOrigin) {
  let values;
  try { values = JSON.parse(raw); } catch { deny("invalid protected runtime secret bundle"); }
  if (!values || typeof values !== "object" || Array.isArray(values) ||
      Object.keys(values).length !== REQUIRED_SECRETS.length ||
      Object.keys(values).some(key => !allowedSecretNames.has(key))) {
    deny("unexpected or missing protected runtime secret names");
  }
  for (const key of REQUIRED_SECRETS) {
    const minimum = ["SESSION_SECRET", "LICENSE_PEPPER", "CRON_SECRET"].includes(key) ? 48 : 1;
    if (!isNonPlaceholder(values[key], minimum)) deny("missing nonproduction runtime secret: " + key);
  }
  if (!/^preproduction[-a-zA-Z0-9._]*$/.test(values.LICENSE_SIGNING_KEY_ID)) {
    deny("dedicated preproduction signing key ID required");
  }
  let redis;
  try { redis = new URL(values.UPSTASH_REDIS_REST_URL); } catch { deny("invalid Redis URL"); }
  if (redis.protocol !== "https:" || redis.username || redis.password ||
      redis.pathname !== "/" || redis.search || redis.hash ||
      !redis.hostname.endsWith(".upstash.io") ||
      redis.origin !== approvedRedisOrigin) {
    deny("Redis must match separately approved nonproduction origin");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.EMAIL_FROM) ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.SUPPORT_EMAIL)) {
    deny("valid operational email identities required");
  }
  try {
    const privateKey = createPrivateKey(values.LICENSE_SIGNING_PRIVATE_KEY);
    const suppliedPublic = createPublicKey(values.LICENSE_SIGNING_PUBLIC_KEY);
    if (privateKey.asymmetricKeyType !== "ed25519" ||
        suppliedPublic.asymmetricKeyType !== "ed25519" ||
        createPublicKey(privateKey).export({type:"spki",format:"pem"}) !==
        suppliedPublic.export({type:"spki",format:"pem"})) {
      deny("signer keys must be a matching nonproduction Ed25519 pair");
    }
  } catch { deny("signer keys must be a matching nonproduction Ed25519 pair"); }
  return values;
}
export function assertLiveCloudflareSnapshot({ accounts, drive, workers }, mode = "verify_only") {
  if (!Array.isArray(accounts) ||
      !accounts.some(account => account.id === proposed.cloudflareAccountId)) {
    deny("Cloudflare account token cannot verify personal preproduction account");
  }
  if (drive?.id !== proposed.hyperdriveId ||
      drive?.name !== proposed.worker ||
      drive?.origin?.host !== proposed.neonDirectHost ||
      drive?.origin?.database !== proposed.database ||
      drive?.origin?.user !== proposed.databaseRole ||
      drive?.origin?.port !== 5432 ||
      !["postgres", "postgresql"].includes(drive?.origin?.scheme) ||
      drive?.caching?.disabled !== true ||
      drive?.mtls?.sslmode !== "require" ||
      drive?.origin_connection_limit !== 10) {
    deny("live Cloudflare Hyperdrive metadata diverged from approved restricted role");
  }
  if (!Array.isArray(workers) || workers.length >= 100)
    deny("Worker inventory cannot be verified");
  const matches = workers.filter(script => (script.id ?? script.name) === proposed.worker);
  if (mode === "activate_access_route") {
    if (matches.length !== 1 || !/^[a-f0-9]{32}$/.test(matches[0]?.tag ?? "") ||
        (matches[0]?.routes?.length ?? 0) !== 0)
      deny("isolated Worker does not exist or has unapproved routes");
  } else if (matches.length !== 0) {
    deny("target already exists; private deploy must never overwrite");
  }
  return {
    worker: proposed.worker,
    origin: proposed.origin,
    cloudflareAccountId: proposed.cloudflareAccountId,
    neonProjectId: proposed.neonProjectId,
    neonBranchId: proposed.neonBranchId,
    neonParentBranchId: null,
    database: proposed.database,
    databaseRole: proposed.databaseRole,
    neonDirectHost: proposed.neonDirectHost,
    hyperdriveId: proposed.hyperdriveId,
    hyperdriveOriginDatabase: drive.origin.database,
    hyperdriveOriginRole: drive.origin.user,
    hyperdriveOriginHost: drive.origin.host,
    hyperdriveCachingDisabled: drive.caching.disabled,
    hyperdriveTlsMode: drive.mtls.sslmode,
    redisPrefix: proposed.namespace,
    workerTag: matches[0]?.tag ?? null,
  };
}

function hasOperatorOnlyPolicy(app, operatorEmail) {
  if (!app || app.type !== "self_hosted" ||
      !Array.isArray(app.policies) || app.policies.length !== 1) return false;
  const p = app.policies[0];
  return p.decision === "allow" && Array.isArray(p.include) &&
    p.include.length === 1 && p.include[0]?.email?.email === operatorEmail &&
    (p.exclude ?? []).length === 0 && Array.isArray(p.require ?? []);
}

export function assertProtectedRouteReadiness({ live, settings, route, apps, subdomain },
    candidate, operatorEmail) {
  const expectedHost = new URL(proposed.origin).hostname;
  if (subdomain?.subdomain !== "jan2xpagauisan" ||
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(operatorEmail ?? "") ||
      route?.enabled !== false || route?.previews_enabled !== false ||
      !Array.isArray(settings?.bindings) || !Array.isArray(apps) ||
      apps.length >= 100 || !/^[a-f0-9]{32}$/.test(live?.workerTag ?? "")) {
    deny("isolated Worker route and exact operator protection not ready");
  }
  const bindings = settings.bindings;
  const byName = name => bindings.filter(b => b.name === name);
  for (const [name, value] of Object.entries(candidate.vars)) {
    const b = byName(name);
    if (b.length !== 1 || b[0]?.type !== "plain_text" || b[0].text !== value)
      deny("isolated Worker source or nonproduction binding diverged: " + name);
  }
  const drive = byName("HYPERDRIVE_FRESH");
  const self = byName("WORKER_SELF_REFERENCE");
  if (drive.length !== 1 || drive[0].type !== "hyperdrive" ||
      drive[0].id !== proposed.hyperdriveId || self.length !== 1 ||
      self[0].type !== "service" || self[0].service !== proposed.worker ||
      bindings.some(b => b.type === "secret_text" && !allowedSecretNames.has(b.name)) ||
      bindings.some(b => b.type === "hyperdrive" && b.name !== "HYPERDRIVE_FRESH") ||
      bindings.some(b => b.type === "service" && b.name !== "WORKER_SELF_REFERENCE")) {
    deny("isolated Worker has unapproved privileged or production bindings");
  }
  // Hostname-only Access never protects alternate Worker version URLs.
  const workerAccess = apps.filter(app => (app.destinations ?? []).some(d =>
    d.type === "worker" && d.worker_id === live.workerTag));
  if (workerAccess.length !== 1 ||
      workerAccess[0].destinations.length !== 1 ||
      workerAccess[0].destinations[0].overrides?.length ||
      !hasOperatorOnlyPolicy(workerAccess[0], operatorEmail)) {
    deny("Worker-level Access protection missing, bypassed or overbroad");
  }
  // Hostname-specific Access takes precedence; reject weaker overrides.
  for (const app of apps) {
    const destinations = app.destinations ?? [];
    if (app.domain === expectedHost || destinations.some(d =>
        d.type === "public" && d.uri === expectedHost)) {
      if (destinations.length !== 1 || destinations[0].type !== "public" ||
          destinations[0].uri !== expectedHost || destinations[0].overrides?.length ||
          !hasOperatorOnlyPolicy(app, operatorEmail)) {
        deny("hostname Access override could bypass isolated Worker protection");
      }
    }
  }
  return true;
}

export async function readLiveCloudflare(token, requester = fetch,
    mode = "verify_only", sourceSha = null, operatorEmail = null) {
  if (!isNonPlaceholder(token, 30)) deny("isolated Cloudflare token absent");
  async function read(path) {
    let response, body;
    try {
      response = await requester("https://api.cloudflare.com/client/v4" + path, {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) deny("Cloudflare read failed");
      body = await response.json();
    } catch { deny("Cloudflare read failed"); }
    if (body?.success !== true) deny("Cloudflare control-plane read failed");
    return body.result;
  }
  const account = proposed.cloudflareAccountId;
  const [accounts, drive, workers] = await Promise.all([
    read("/accounts?per_page=100"),
    read("/accounts/" + account + "/hyperdrive/configs/" + proposed.hyperdriveId),
    read("/accounts/" + account + "/workers/scripts?per_page=100"),
  ]);
  const live = assertLiveCloudflareSnapshot({ accounts, drive, workers }, mode);
  if (mode === "activate_access_route") {
    const [settings, route, apps, subdomain] = await Promise.all([
      read("/accounts/" + account + "/workers/scripts/" + proposed.worker + "/settings"),
      read("/accounts/" + account + "/workers/scripts/" + proposed.worker + "/subdomain"),
      read("/accounts/" + account + "/access/apps"),
      read("/accounts/" + account + "/workers/subdomain"),
    ]);
    const candidate = buildPreproductionWorkerCandidate(
      JSON.parse(readFileSync("wrangler.jsonc", "utf8")), live, sourceSha);
    assertProtectedRouteReadiness({ live, settings, route, apps, subdomain },
      candidate, operatorEmail);
  }
  return live;
}
export function assertDeploymentApprovals(env, secretBundle) {
  if (env.PREPRODUCTION_WORKER_APPROVED_ORIGIN !== proposed.origin ||
      env.PREPRODUCTION_WORKER_RUNTIME_CUSTODY !== "ISOLATED_PREPRODUCTION_ONLY" ||
      env.PREPRODUCTION_WORKER_SIGNER_CUSTODY !== "NONPRODUCTION_ED25519_ONLY") {
    deny("protected origin, identity and signer custody not approved");
  }
  return assertRuntimeSecretBundle(secretBundle, env.PREPRODUCTION_WORKER_APPROVED_REDIS_ORIGIN);
}
export async function prepareOperator(env = process.env, requester = fetch) {
  const mode = assertOperatorContext(env);
  // No caller-supplied snapshot is accepted. Every invocation independently GETs
  // account, Hyperdrive and Worker inventory using a scoped protected API token.
  const live = await readLiveCloudflare(env.CLOUDFLARE_API_TOKEN, requester);
  assertIndependentPreproductionIdentity(live);
  const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  const candidate = buildPreproductionWorkerCandidate(source, live);
  if (mode === "deploy") {
    const secrets = assertDeploymentApprovals(env, env.PREPRODUCTION_WORKER_SECRETS_JSON);
    const temp = env.RUNNER_TEMP;
    if (!temp || !temp.startsWith("/") || temp.includes("\n")) deny("ephemeral runner temp required");
    writeFileSync(join(temp, "bke-preproduction-runtime.json"), JSON.stringify(secrets),
      { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
  writeFileSync(".wrangler-preproduction.json", JSON.stringify(candidate, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600, flag: "wx" });
  return mode;
}
if (process.argv[1]?.endsWith("/preproduction-worker-operator.mjs")) {
  prepareOperator().then(mode => {
    console.log("PASS: independently read verified personal account/Hyperdrive, isolated target, mode " + mode);
    if (mode === "verify_only") console.log("NO DEPLOY: source candidate only; no credentials published");
  }).catch(error => {
    console.error(error.message.startsWith("PREPRODUCTION_") ?
      error.message : "PREPRODUCTION_WORKER_DENIED: preflight error");
    process.exitCode = 1;
  });
}
