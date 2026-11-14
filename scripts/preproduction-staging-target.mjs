// Source-only, inert candidate builder. Never provisions, publishes or dispatches.
// Live Neon/Cloudflare approval and exact provenance remain separate protected gates.
const PROD = Object.freeze({
  worker: "bke-digital-solutions",
  host: "bkedigitalsolutions.com",
  neonProject: "lingering-pond-33730332",
  legacyProject: "bold-hat-55602908",
  hyperdrive: "ea1691c683e64bd0b9acc3489ab7759c",
});
// Control-plane values independently observed 2026-11-14. This source-only
// guard is NOT a live Cloudflare/Neon attestation or permission to deploy.
export const proposed = Object.freeze({
  worker: "bke-digital-solutions-preproduction",
  origin: "https://preproduction.bkedigitalsolutions.com",
  cloudflareAccountId: "9e39768c751719bfdfc4b915d2afd017",
  neonProjectId: "tiny-mouse-06099628",
  neonBranchId: "br-divine-dream-a1qhc381",
  neonDirectHost: "ep-polished-glade-a1u174wx.ap-southeast-1.aws.neon.tech",
  hyperdriveId: "437f92c3b9a14489be6e3e7f21307821",
  database: "bke_preproduction",
  databaseRole: "bke_preproduction_runtime",
  namespace: "bke-preproduction",
});
function deny(reason) {
  throw new Error("PREPRODUCTION_TARGET_DENIED: " + reason);
}
function requiredText(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
export function assertIndependentPreproductionIdentity(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) deny("missing independent target identity");
  if (target.worker !== proposed.worker || target.worker === PROD.worker) deny("Worker must be independent of production");
  if (target.cloudflareAccountId !== proposed.cloudflareAccountId) {
    deny("Cloudflare account is not the owner-approved personal preproduction account");
  }
  if (target.origin !== proposed.origin) deny("origin must be explicitly selected for preproduction, never the production apex");
  const origin = new URL(target.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.port || origin.pathname !== "/" || origin.search || origin.hash ||
      origin.hostname === PROD.host || origin.hostname.endsWith(".workers.dev")) {
    deny("origin is not an isolated HTTPS preproduction hostname");
  }
  if (!requiredText(target.neonProjectId) ||
      !/^[a-z0-9-]+$/.test(target.neonProjectId) ||
      target.neonProjectId !== proposed.neonProjectId ||
      [PROD.neonProject, PROD.legacyProject].includes(target.neonProjectId)) {
    deny("Neon project must be independently created, not production or legacy");
  }
  if (!requiredText(target.neonBranchId) ||
      !/^br-[a-z0-9-]+$/.test(target.neonBranchId) ||
      ["br-autumn-morning-az7buyxu", "br-hidden-shape-az7g4y2f",
       "br-misty-thunder-az3g9r63", "br-soft-dawn-az9q94rd",
       "br-fragrant-salad-azee6zgq"].includes(target.neonBranchId) ||
      target.neonBranchId !== proposed.neonBranchId ||
      target.neonParentBranchId !== null) {
    deny("Neon branch must be an independent new-project root, never a cloned production/legacy branch");
  }
  if (target.database !== proposed.database || target.databaseRole !== proposed.databaseRole) {
    deny("database and role must be isolated preproduction identities");
  }
  if (!requiredText(target.neonDirectHost) ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(target.neonDirectHost) ||
      target.neonDirectHost.includes("-pooler") ||
      target.neonDirectHost !== proposed.neonDirectHost ||
      target.neonDirectHost === "ep-raspy-bread-azsc0112.c-3.ap-southeast-1.aws.neon.tech") {
    deny("Neon direct endpoint must be distinct from production");
  }
  if (!requiredText(target.hyperdriveId) ||
      !/^[a-f0-9]{32}$/.test(target.hyperdriveId) ||
      /^0{32}$/.test(target.hyperdriveId) ||
      target.hyperdriveId !== proposed.hyperdriveId ||
      target.hyperdriveId === PROD.hyperdrive) {
    deny("Hyperdrive must be independently created, never production or placeholder");
  }
  // These are supplied *read-only control-plane fields*, not authority that a
  // caller may invent. Before any deployment, independently fetch Hyperdrive
  // from the owner-approved Cloudflare account and pass its actual properties.
  if (target.hyperdriveOriginDatabase !== proposed.database ||
      target.hyperdriveOriginRole !== proposed.databaseRole ||
      target.hyperdriveOriginHost !== proposed.neonDirectHost ||
      target.hyperdriveCachingDisabled !== true ||
      target.hyperdriveTlsMode !== "require") {
    deny("Hyperdrive runtime role, direct host, database, cache and TLS must match readback");
  }
  if (target.redisPrefix !== proposed.namespace) deny("Redis namespace must be preproduction only");
  return true;
}
const allowedSourceKeys = new Set([
  "$schema", "name", "workers_dev", "preview_urls", "main", "minify",
  "compatibility_date", "compatibility_flags", "assets", "services",
  "hyperdrive", "vars", "observability", "send_email",
]);
function validateSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) deny("missing source manifest");
  if (Object.keys(source).some((key) => !allowedSourceKeys.has(key))) deny("unexpected source Wrangler capability");
  if (source.name !== PROD.worker || source.workers_dev !== false ||
      source.preview_urls !== false || source.main !== "workers/entry.ts" ||
      source.assets?.directory !== ".open-next/assets" ||
      source.assets?.binding !== "ASSETS") {
    deny("source Worker identity or assets contract is not canonical");
  }
  if (source.observability?.enabled !== true ||
      source.observability?.redact_query_string !== true) {
    deny("observability and query-string redaction are required");
  }
  if (Object.keys(source.vars ?? {}).length !== 1 ||
      source.vars?.BKE_RUNTIME !== "workers") deny("source manifest carries unexpected variables");
  if (!Array.isArray(source.services) || source.services.length !== 1 ||
      source.services[0].binding !== "WORKER_SELF_REFERENCE" ||
      source.services[0].service !== PROD.worker) {
    deny("unexpected production source service binding");
  }
  if (!Array.isArray(source.hyperdrive) || source.hyperdrive.length !== 1 ||
      source.hyperdrive[0].binding !== "HYPERDRIVE_FRESH" ||
      !["00000000000000000000000000000000", PROD.hyperdrive].includes(source.hyperdrive[0].id)) {
    deny("unexpected production source Hyperdrive binding");
  }
  if (!Array.isArray(source.send_email) || source.send_email.length !== 1 ||
      source.send_email[0].name !== "EMAIL") deny("unexpected production source email binding");
}
export function buildPreproductionWorkerCandidate(source, target) {
  assertIndependentPreproductionIdentity(target);
  validateSource(source);
  const config = structuredClone(source);
  config.name = proposed.worker;
  config.workers_dev = false;
  config.preview_urls = false;
  config.services = [{ binding: "WORKER_SELF_REFERENCE", service: proposed.worker }];
  config.hyperdrive = [{ binding: "HYPERDRIVE_FRESH", id: target.hyperdriveId }];
  config.observability = {
    enabled: true, head_sampling_rate: 1, redact_query_string: true,
    logs: { enabled: true },
  };
  // No public routing, scheduled triggers, email sending or inherited production dashboard vars.
  delete config.send_email;
  config.vars = {
    BKE_RUNTIME: "workers",
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "staging",
    APP_URL: proposed.origin,
    DEPLOYMENT_ID: proposed.namespace,
    REDIS_KEY_PREFIX: proposed.namespace,
    PAYMENT_PROVIDER: "mock",
    PAYMONGO_LIVEMODE: "false",
    EMAIL_PROVIDER: "log",
    CLAIM_CODE_CHECKOUT_ENABLED: "false",
    AGENT_ACCOUNT_SESSION_ENABLED: "false",
    BACKUP_ENABLED: "false",
    STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED: "false",
    STANDALONE_STARTUP_POLICY_HTTP_ENABLED: "false",
  };
  return config;
}
