import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const target = Object.freeze({
  accountId: "384c6c13373eb94a2925e0d865139970",
  worker: "bke-digital-solutions",
  domain: "bkedigitalsolutions.com",
  appUrl: "https://bkedigitalsolutions.com",
  deploymentId: "bke-production",
  hyperdriveId: "ea1691c683e64bd0b9acc3489ab7759c",
  hyperdriveName: "bke-digital-solutions-production",
  database: "bke_production",
});
export const generatedConfig = ".wrangler-web-production.json";
export const snapshotFile = ".wrangler-web-production-snapshot.json";

function reject(msg) { throw new Error("WEB_RELEASE_GATE: " + msg); }
function requireMatch(actual, expected, name) {
  if (actual !== expected) reject(name + " does not match the approved deployment target");
}

export function buildProductionConfig(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) reject("Invalid Wrangler configuration");
  const config = structuredClone(source);
  requireMatch(config.name, target.worker, "Worker name");
  requireMatch(config.main, "workers/entry.ts", "Worker entry");
  requireMatch(config.assets?.directory, ".open-next/assets", "Static asset path");
  if (config.route || config.routes || config.env || config.triggers?.crons?.length) {
    reject("Unexpected route/environment/cron ownership");
  }
  if (!Array.isArray(config.hyperdrive) || config.hyperdrive.length !== 1 ||
      config.hyperdrive[0].binding !== "HYPERDRIVE_FRESH") reject("Unexpected Hyperdrive binding");
  if (!Array.isArray(config.services) || config.services.length !== 1 ||
      config.services[0].binding !== "WORKER_SELF_REFERENCE" ||
      config.services[0].service !== target.worker) reject("Self-service binding changed");
  if (!Array.isArray(config.send_email) || config.send_email.length !== 1 ||
      config.send_email[0].name !== "EMAIL") reject("Existing email binding changed");
  if (config.observability?.enabled !== true || config.observability.redact_query_string !== true) {
    reject("Production log redaction is required");
  }
  if (config.vars?.BKE_RUNTIME !== "workers" ||
      Object.keys(config.vars || {}).some((key) => key !== "BKE_RUNTIME")) {
    reject("Source variables must not override protected dashboard configuration");
  }
  // Preserve all existing Cloudflare dashboard plain variables and secret names.
  // Wrangler --keep-vars preserves existing dashboard variables at publish time.
  // Do not add undocumented keep_vars to the source config schema.
  config.workers_dev = false;
  config.hyperdrive[0] = { binding: "HYPERDRIVE_FRESH", id: target.hyperdriveId };
  // No routes key: existing custom domain remains controlled by Cloudflare.
  return config;
}

export function bindingFingerprint(bindings) {
  if (!Array.isArray(bindings)) reject("No existing Worker bindings returned");
  const names = new Set();
  const stable = bindings.map((binding) => {
    if (typeof binding.name !== "string" || typeof binding.type !== "string" || names.has(binding.name)) {
      reject("Invalid or duplicate Worker binding");
    }
    names.add(binding.name);
    return {
      name: binding.name, type: binding.type,
      ...(binding.type === "plain_text" ? { text: binding.text } : {}),
      ...(binding.type === "hyperdrive" ? { id: binding.id } : {}),
      ...(binding.type === "service" ? { service: binding.service, environment: binding.environment } : {}),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(bindings.map((binding) => [binding.name, binding]));
  for (const [name, type] of [
    ["ASSETS", "assets"], ["WORKER_SELF_REFERENCE", "service"],
    ["HYPERDRIVE_FRESH", "hyperdrive"], ["EMAIL", "send_email"],
    ["SESSION_SECRET", "secret_text"], ["GOOGLE_CLIENT_SECRET", "secret_text"],
    ["GOOGLE_CLIENT_ID", "plain_text"], ["UPSTASH_REDIS_REST_TOKEN", "secret_text"],
    ["UPSTASH_REDIS_REST_URL", "secret_text"], ["APP_URL", "plain_text"],
    ["DEPLOYMENT_ENV", "plain_text"], ["DEPLOYMENT_ID", "plain_text"],
    ["NODE_ENV", "plain_text"], ["BKE_RUNTIME", "plain_text"],
  ]) {
    if (byName.get(name)?.type !== type) reject("Missing or altered required binding: " + name);
  }
  requireMatch(byName.get("APP_URL")?.text, target.appUrl, "APP_URL");
  requireMatch(byName.get("DEPLOYMENT_ENV")?.text, "production", "DEPLOYMENT_ENV");
  requireMatch(byName.get("DEPLOYMENT_ID")?.text, target.deploymentId, "DEPLOYMENT_ID");
  requireMatch(byName.get("NODE_ENV")?.text, "production", "NODE_ENV");
  requireMatch(byName.get("BKE_RUNTIME")?.text, "workers", "BKE_RUNTIME");
  requireMatch(byName.get("HYPERDRIVE_FRESH")?.id, target.hyperdriveId, "Hyperdrive ID");
  requireMatch(byName.get("WORKER_SELF_REFERENCE")?.service, target.worker, "Self-service target");
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function assertHyperdrive(drive) {
  if (!drive) reject("Hyperdrive absent");
  requireMatch(drive.id, target.hyperdriveId, "Hyperdrive ID");
  requireMatch(drive.name, target.hyperdriveName, "Hyperdrive name");
  requireMatch(drive.origin?.database, target.database, "Neon database");
  if (!String(drive.origin?.host ?? "").endsWith(".neon.tech")) reject("Hyperdrive origin must be Neon");
  if (drive.caching?.disabled !== true) reject("Hyperdrive query caching must remain disabled");
  if (!["postgres", "postgresql"].includes(String(drive.origin?.scheme))) reject("Hyperdrive origin protocol mismatch");
  return true;
}

function requireToken() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== target.accountId) reject("Cloudflare account mismatch");
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) reject("Protected Cloudflare token missing");
  return token;
}

async function cfGet(path) {
  const token = requireToken();
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    headers: { authorization: "Bearer " + token, accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) reject("Cloudflare metadata HTTP " + response.status);
  const json = await response.json();
  if (json.success !== true) reject("Cloudflare metadata rejected request");
  return json.result;
}

export async function inspectLive() {
  const base = "/accounts/" + target.accountId + "/workers/scripts/" + target.worker;
  const [settings, hyperdrive, domains, deployments, scriptSettings] = await Promise.all([
    cfGet(base + "/settings"),
    cfGet("/accounts/" + target.accountId + "/hyperdrive/configs/" + target.hyperdriveId),
    cfGet("/accounts/" + target.accountId + "/workers/domains"),
    cfGet(base + "/deployments"),
    cfGet(base + "/script-settings"),
  ]);
  const fingerprint = bindingFingerprint(settings.bindings);
  assertHyperdrive(hyperdrive);
  if (!domains.some((d) => d.hostname === target.domain && d.service === target.worker &&
      d.environment === "production")) reject("Production custom domain not attached to target Worker");
  if (!scriptSettings?.observability?.enabled || !scriptSettings?.observability?.logs?.enabled ||
      scriptSettings?.observability?.redact_query_string !== true) reject("Query-string redaction missing");
  const latest = deployments.deployments?.[0];
  if (!latest?.versions || latest.versions.length !== 1 ||
      latest.versions[0].percentage !== 100 ||
      !/^[0-9a-f-]{36}$/i.test(latest.versions[0].version_id)) reject("Unexpected live deployment split");
  return { fingerprint, version: latest.versions[0].version_id };
}

export async function prepare() {
  const source = JSON.parse(await readFile("wrangler.jsonc", "utf8"));
  const config = buildProductionConfig(source);
  await writeFile(generatedConfig, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("PASS: production code-only Wrangler manifest materialized without secrets");
}

export async function snapshot() {
  const record = await inspectLive();
  await writeFile(snapshotFile, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log("PASS: live Cloudflare Worker bindings/domain/Hyperdrive confirmed; old version " + record.version);
}

export async function verify() {
  const record = JSON.parse(await readFile(snapshotFile, "utf8"));
  const now = await inspectLive();
  requireMatch(now.fingerprint, record.fingerprint, "Retained Cloudflare binding fingerprint");
  if (now.version === record.version) reject("No new deployed Worker version was observed");
  console.log("PASS: new Worker version deployed; all protected bindings and custom domain preserved");
}

export async function previousVersion() {
  const record = JSON.parse(await readFile(snapshotFile, "utf8"));
  if (!/^[0-9a-f-]{36}$/i.test(record.version)) reject("Saved rollback version missing");
  console.log(record.version);
}

export async function cleanup() {
  await Promise.all([rm(generatedConfig, { force: true }), rm(snapshotFile, { force: true })]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "prepare") await prepare();
  else if (command === "snapshot") await snapshot();
  else if (command === "verify") await verify();
  else if (command === "previous-version") await previousVersion();
  else if (command === "cleanup") await cleanup();
  else reject("Unknown code-only release command");
}
