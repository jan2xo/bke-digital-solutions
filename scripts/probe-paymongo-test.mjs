import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.paymongo.com";
const CHECKOUT_REDIRECT_ORIGIN = "https://jl-bke.com";

function fail(code) {
  throw new Error(code);
}

export function assertTestModeCredentials(environment = process.env) {
  if (environment.DEPLOYMENT_ENV !== "test") fail("PAYMONGO_TEST_ENV_REQUIRED");
  if (environment.PAYMONGO_LIVEMODE !== "false") fail("PAYMONGO_TEST_LIVEMODE_MUST_BE_FALSE");
  if (environment.PAYMENT_PROVIDER !== "paymongo") fail("PAYMONGO_TEST_PROVIDER_REQUIRED");
  if (environment.DATABASE_URL || environment.DIRECT_DATABASE_URL) {
    fail("PAYMONGO_TEST_DATABASE_ACCESS_FORBIDDEN");
  }

  const key = environment.PAYMONGO_TEST_MODE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = environment.PAYMONGO_TEST_MODE_WEBHOOK_SECRET?.trim() ?? "";
  if (!/^sk_test_[A-Za-z0-9_-]{12,}$/.test(key)) fail("PAYMONGO_TEST_KEY_MISSING_OR_NOT_TEST");
  if (webhookSecret.length < 16 || webhookSecret === key) fail("PAYMONGO_TEST_WEBHOOK_SECRET_INVALID");
  return { key, webhookSecret };
}

export async function probePayMongoTest({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  createCheckout = false,
  nonce = randomUUID,
} = {}) {
  const { key } = assertTestModeCredentials(environment);
  const authorization = "Basic " + Buffer.from(key + ":").toString("base64");
  let response;
  try {
    response = await fetchImpl(API_ORIGIN + "/v1/payment_methods", {
      method: "GET",
      headers: { authorization, accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail("PAYMONGO_TEST_AUTH_NETWORK_ERROR");
  }
  if (response.status === 401 || response.status === 403) fail("PAYMONGO_TEST_KEY_REJECTED");
  if (response.status !== 200) fail("PAYMONGO_TEST_AUTH_HTTP_" + response.status);
  // No provider JSON printed (the account may contain private configuration).
  if (!createCheckout) {
    return { status: "PASS", key: "AUTHENTICATED", checkout: "NOT_REQUESTED", webhook: "SECRET_PRESENT_NOT_PROVIDER_VERIFIED" };
  }

  const reference = "BKE-SANDBOX-" + nonce().replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  const order = {
    data: {
      attributes: {
        billing: { name: "BKE Test Mode", email: "paymongo-test@bke.test" },
        line_items: [{ name: "BKE sandbox proof", description: "No real payment", amount: 10000, currency: "PHP", quantity: 1 }],
        payment_method_types: ["qrph"],
        reference_number: reference,
        success_url: CHECKOUT_REDIRECT_ORIGIN + "/checkout/success?test=1",
        cancel_url: CHECKOUT_REDIRECT_ORIGIN + "/checkout/cancel?test=1",
        send_email_receipt: false,
        show_line_items: true,
      },
    },
  };
  try {
    response = await fetchImpl(API_ORIGIN + "/v1/checkout_sessions", {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "idempotency-key": reference,
      },
      body: JSON.stringify(order),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    fail("PAYMONGO_TEST_CHECKOUT_NETWORK_ERROR");
  }
  if (!response.ok) fail("PAYMONGO_TEST_CHECKOUT_HTTP_" + response.status);
  let body;
  try {
    const data = await response.text();
    if (data.length > 65536) fail("PAYMONGO_TEST_CHECKOUT_RESPONSE_TOO_LARGE");
    body = JSON.parse(data);
  } catch {
    fail("PAYMONGO_TEST_CHECKOUT_INVALID_RESPONSE");
  }
  if (
    typeof body?.data?.id !== "string" ||
    !body.data.id.startsWith("cs_") ||
    typeof body?.data?.attributes?.checkout_url !== "string" ||
    !body.data.attributes.checkout_url.startsWith("https://") ||
    body.data.attributes.livemode === true
  ) fail("PAYMONGO_TEST_CHECKOUT_INVALID_OR_LIVE");
  // Deliberately never print the checkout URL, provider ID, customer material or keys.
  return { status: "PASS", key: "AUTHENTICATED", checkout: "TEST_SESSION_CREATED", webhook: "SECRET_PRESENT_NOT_PROVIDER_VERIFIED" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const checkout = process.argv.includes("--checkout");
    const result = await probePayMongoTest({ createCheckout: checkout });
    process.stdout.write("PayMongo protected TEST probe: " + Object.entries(result).map(([k, v]) => k + "=" + v).join(" ") + "\n");
  } catch (error) {
    const safe = error instanceof Error && /^PAYMONGO_TEST_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "PAYMONGO_TEST_PROBE_FAILED";
    process.stderr.write("PayMongo protected TEST probe: FAIL " + safe + "\n");
    process.exitCode = 1;
  }
}
