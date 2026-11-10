import { pathToFileURL } from "node:url";
import { probePayMongoTest } from "./probe-paymongo-test.mjs";

const INFISICAL_ORIGIN = "https://app.infisical.com";
const TEST_SECRET_NAMES = Object.freeze([
  "PAYMONGO_TEST_MODE_SECRET_KEY",
  "PAYMONGO_TEST_MODE_WEBHOOK_SECRET",
]);

function fail(code) {
  throw new Error(code);
}

async function fetchJson(url, options, fetchImpl, failureCode) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail(failureCode + "_NETWORK");
  }
  if (!response?.ok) fail(failureCode + "_HTTP_" + (response?.status ?? "UNKNOWN"));
  let data;
  try {
    const raw = await response.text();
    if (raw.length > 65536) fail(failureCode + "_TOO_LARGE");
    data = JSON.parse(raw);
  } catch {
    fail(failureCode + "_INVALID_RESPONSE");
  }
  return data;
}

/**
 * No bulk secret export: only the two named test credentials are retrieved.
 * The existing protected Production environment supplies the OIDC identity,
 * but this process does not read or pass any production PayMongo/Neon secret.
 */
export async function readNamedTestCredentials({
  environment = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const identityId = environment.INFISICAL_PRODUCTION_IDENTITY_ID?.trim() ?? "";
  const projectId = environment.INFISICAL_PRODUCTION_PROJECT_ID?.trim() ?? "";
  const oidcRequestUrl = environment.ACTIONS_ID_TOKEN_REQUEST_URL ?? "";
  const oidcRequestToken = environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN ?? "";
  if (
    environment.GITHUB_REPOSITORY !== "jan2xo/bke-digital-solutions" ||
    environment.GITHUB_REF !== "refs/heads/main"
  ) fail("PAYMONGO_TEST_TRUSTED_MAIN_REQUIRED");
  if (!identityId || !projectId) fail("PAYMONGO_TEST_EXISTING_INFISICAL_CONNECTION_MISSING");
  if (!oidcRequestUrl || !oidcRequestToken) fail("PAYMONGO_TEST_GITHUB_OIDC_UNAVAILABLE");
  let jwtUrl;
  try { jwtUrl = new URL(oidcRequestUrl); } catch { fail("PAYMONGO_TEST_GITHUB_OIDC_INVALID_URL"); }
  if (jwtUrl.protocol !== "https:" || !jwtUrl.hostname.endsWith(".actions.githubusercontent.com")) {
    fail("PAYMONGO_TEST_GITHUB_OIDC_INVALID_URL");
  }

  const oidcData = await fetchJson(
    jwtUrl.toString(),
    { headers: { authorization: "Bearer " + oidcRequestToken } },
    fetchImpl,
    "PAYMONGO_TEST_GITHUB_OIDC",
  );
  if (typeof oidcData?.value !== "string" || oidcData.value.length < 100) {
    fail("PAYMONGO_TEST_GITHUB_OIDC_INVALID_TOKEN");
  }

  const login = await fetchJson(
    INFISICAL_ORIGIN + "/api/v1/auth/oidc-auth/login",
    {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ identityId, jwt: oidcData.value }),
    },
    fetchImpl,
    "PAYMONGO_TEST_INFISICAL_OIDC",
  );
  const token = login?.accessToken;
  if (typeof token !== "string" || token.length < 20) {
    fail("PAYMONGO_TEST_INFISICAL_SESSION_INVALID");
  }

  const values = Object.create(null);
  for (const name of TEST_SECRET_NAMES) {
    const url = new URL(INFISICAL_ORIGIN + "/api/v4/secrets/" + encodeURIComponent(name));
    url.searchParams.set("projectId", projectId);
    url.searchParams.set("environment", "prod");
    url.searchParams.set("secretPath", "/");
    const result = await fetchJson(
      url.toString(),
      { headers: { authorization: "Bearer " + token, accept: "application/json" } },
      fetchImpl,
      "PAYMONGO_TEST_INFISICAL_NAMED_SECRET",
    );
    const value = result?.secret?.secretValue;
    if (typeof value !== "string" || value.length < 16) {
      fail("PAYMONGO_TEST_INFISICAL_NAMED_SECRET_INVALID");
    }
    values[name] = value;
  }
  return {
    DEPLOYMENT_ENV: "test",
    PAYMENT_PROVIDER: "paymongo",
    PAYMONGO_LIVEMODE: "false",
    PAYMONGO_TEST_MODE_SECRET_KEY: values.PAYMONGO_TEST_MODE_SECRET_KEY,
    PAYMONGO_TEST_MODE_WEBHOOK_SECRET: values.PAYMONGO_TEST_MODE_WEBHOOK_SECRET,
  };
}

export async function runProtectedTestProbe({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  createCheckout = false,
} = {}) {
  const isolatedTestEnvironment = await readNamedTestCredentials({ environment, fetchImpl });
  return probePayMongoTest({
    environment: isolatedTestEnvironment,
    fetchImpl,
    createCheckout,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runProtectedTestProbe({
      createCheckout: process.argv.includes("--checkout"),
    });
    process.stdout.write("PayMongo protected TEST probe: " +
      Object.entries(result).map(([key, value]) => key + "=" + value).join(" ") + "\n");
  } catch (error) {
    const code = error instanceof Error && /^PAYMONGO_TEST_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "PAYMONGO_TEST_INFISICAL_PROBE_FAILED";
    process.stderr.write("PayMongo protected TEST probe: FAIL " + code + "\n");
    process.exitCode = 1;
  }
}
