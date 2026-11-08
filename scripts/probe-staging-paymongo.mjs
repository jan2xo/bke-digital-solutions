import { pathToFileURL } from "node:url";

const endpoint = "https://api.paymongo.com/v1/merchants/capabilities/payment_methods";
const acceptableMethods = new Set(["qrph"]);

function fail(code) { throw new Error(code); }
function activeMethods(response) {
  const paths = [
    response,
    response?.data,
    response?.data?.attributes,
    response?.data?.attributes?.payment_methods,
    response?.data?.payment_methods,
    response?.payment_methods,
    response?.methods,
  ];
  const list = paths.find((value) => Array.isArray(value));
  if (!list) fail("PAYMONGO_CAPABILITIES_FORMAT_UNRECOGNIZED");
  return list.filter((method) => typeof method === "string")
    .map((method) => method.toLowerCase());
}

/**
 * This is deliberately ONLY an authenticated GET. No checkout is created,
 * no QR is issued, no order is persisted, and no payment can be collected.
 * It uses Staging OIDC to retrieve a stored live secret in memory, never the
 * deployed Staging Worker. The existing production-only runtime guard stays.
 */
export async function probeStagingPayMongoLive(
  environment = process.env,
  fetchImpl = globalThis.fetch,
) {
  const secret = environment.PAYMONGO_SECRET_KEY?.trim() ?? "";
  if (!secret) return {status: "SKIPPED", code: "NO_PAYMONGO_SECRET_IN_STAGING"};
  if (!/^sk_live_[A-Za-z0-9_-]{12,}$/.test(secret)) fail("PAYMONGO_LIVE_KEY_REQUIRED");
  const webhookSecret = environment.PAYMONGO_WEBHOOK_SECRET?.trim() ?? "";
  if (webhookSecret.length < 16 || webhookSecret === secret) fail("PAYMONGO_LIVE_WEBHOOK_SECRET_MISSING");
  if (environment.APP_URL !== "https://bkedigitalsolutions.com") fail("PAYMONGO_PROBE_ORIGIN_MISMATCH");
  if (environment.DEPLOYMENT_ENV !== "staging") fail("PAYMONGO_PROBE_STAGING_ONLY");
  // Do not change PAYMENT_PROVIDER or PAYMONGO_LIVEMODE in the deployed Worker.
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        authorization: "Basic " + Buffer.from(secret + ":").toString("base64"),
        accept: "application/json",
      },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    fail("PAYMONGO_CAPABILITIES_NETWORK_FAILURE");
  }
  if (response.status === 401 || response.status === 403) fail("PAYMONGO_LIVE_KEY_REJECTED");
  if (response.status !== 200) fail("PAYMONGO_CAPABILITIES_HTTP_" + String(response.status));
  let data;
  try {
    const raw = await response.text();
    if (raw.length > 65_536) fail("PAYMONGO_CAPABILITIES_TOO_LARGE");
    data = JSON.parse(raw);
  } catch {
    fail("PAYMONGO_CAPABILITIES_INVALID_RESPONSE");
  }
  const methods = activeMethods(data);
  if (!methods.some((name) => acceptableMethods.has(name))) {
    return {status: "FAILED", code: "PAYMONGO_QRPH_NOT_ENABLED"};
  }
  return {status: "PASS", code: "LIVE_KEY_AUTHENTICATED_QRPH_ENABLED"};
}

async function main() {
  try {
    const result = await probeStagingPayMongoLive();
    console.log("Staging PayMongo legacy credential probe: " + result.status + " " + result.code);
    if (result.status === "FAILED") process.exitCode = 1;
  } catch (error) {
    // Never log provider error body, Authorization headers, payment URLs or keys.
    const code = error instanceof Error && /^PAYMONGO_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "PAYMONGO_PROBE_FAILED";
    console.error("Staging PayMongo legacy credential probe: FAILED " + code);
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
