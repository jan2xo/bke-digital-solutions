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
export function assertLiveCloudflareSnapshot({ accounts, drive, workers }) {
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
  if (!Array.isArray(workers) ||
      workers.some(script => (script.id ?? script.name) === proposed.worker)) {
    deny("target already exists or Worker inventory cannot be verified; no overwrite");
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
  };
}
export async function readLiveCloudflare(token, requester = fetch) {
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
  return assertLiveCloudflareSnapshot({ accounts, drive, workers });
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
