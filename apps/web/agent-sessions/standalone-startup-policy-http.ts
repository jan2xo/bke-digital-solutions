import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectBrowserOriginForAgent } from "./contract";
import { smallJson } from "./agent-key-http";
import { issueStandaloneStartupPolicyPreproduction } from
  "./standalone-startup-policy-issuance";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getRuntimeEnvironment } from "@/platform/host/env";

// A signed installed-Agent attestation authenticates the machine.
// A Google/account bearer must NOT be required for LICENSE_KEY startup.
// Production has no entrypoint: both generation-independent switches default
// OFF, and the runtime must explicitly be the separate staging environment.
export const STARTUP_POLICY_HTTP_PROTOCOL = "bke.installed-startup-issuance.v1";
const HEADER = "x-bke-startup-policy-protocol";
const KID = /^[A-Za-z0-9._-]{1,128}$/;
const inputSchema = z.object({
  signed_install_attestation: z.string().min(1).max(7000),
}).strict();

function response(payload: unknown, status: number) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "pragma": "no-cache",
      [HEADER]: STARTUP_POLICY_HTTP_PROTOCOL,
    },
  });
}

function attestedKeyHint(raw: string): string {
  // Untrusted key ID is used ONLY as a bounded throttle label; the real
  // cryptographic trust anchor is checked under SQL inside the issuer.
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("INVALID_INPUT"); }
  if (parsed === null || typeof parsed !== "object" ||
      Array.isArray(parsed) || !KID.test(
        (parsed as { kid?: unknown }).kid as string))
    throw new Error("INVALID_INPUT");
  return (parsed as { kid: string }).kid;
}

/** Never return the signing keyset, input attestation, SQL facts or raw errors. */
export async function standaloneStartupPolicyHttp(request: Request) {
  // Check the process environment first in case runtime config itself is
  // invalid. Even an accidental production flag cannot expose this route.
  if (process.env.DEPLOYMENT_ENV === "production")
    return response({ error: "NOT_FOUND" }, 404);

  try {
    const config = getRuntimeEnvironment();
    if (config.DEPLOYMENT_ENV !== "staging" ||
        !config.STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED ||
        !config.STANDALONE_STARTUP_POLICY_HTTP_ENABLED ||
        !config.ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON)
      return response({ error: "NOT_FOUND" }, 404);

    rejectBrowserOriginForAgent(request);
    // Do not ingest ambient customer/browser sessions or a separate bearer.
    // The only issuance authority is the ACTIVE enrolled Agent signature.
    if (request.headers.has("cookie") || request.headers.has("authorization"))
      return response({ error: "BROWSER_SESSION_REJECTED" }, 403);
    if (request.headers.get(HEADER) !== STARTUP_POLICY_HTTP_PROTOCOL)
      return response({ error: "PROTOCOL_MISMATCH" }, 400);

    // First, throttle by IP before parsing any untrusted body. Staging uses
    // a distributed Redis/Valkey limiter and fails closed on outage.
    const ip = clientIp(request);
    if (!(await rateLimit("startup-policy:http:ip:" + ip, 30, 3600)).allowed)
      return response({ error: "RATE_LIMITED" }, 429);

    const body = inputSchema.safeParse(await smallJson(request));
    if (!body.success)
      return response({ error: "INVALID_INPUT" }, 400);
    const attestation = body.data.signed_install_attestation;
    const kid = attestedKeyHint(attestation);
    const hashedKid = createHash("sha256").update(kid, "utf8").digest("hex");
    if (!(await rateLimit(
      "startup-policy:http:machine:" + hashedKid, 12, 3600)).allowed)
      return response({ error: "RATE_LIMITED" }, 429);

    // The internal service runs ONE SERIALIZABLE SQL transaction: verify
    // the independently enrolled machine signature and release/mode, consume
    // the unique attestation, lock the real ACTIVE DS signer, sign and audit.
    // The response is not sent until that transaction commits.
    const issued = await issueStandaloneStartupPolicyPreproduction(attestation);
    return response({
      status: "issued",
      signed_policy_envelope: issued.envelope,
      kid: issued.kid,
      activation_mode: issued.mode,
      expires_at: issued.expiresAt,
    }, 201);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "PAYLOAD_TOO_LARGE")
      return response({ error: "PAYLOAD_TOO_LARGE" }, 413);
    if (reason === "INVALID_INPUT")
      return response({ error: "INVALID_INPUT" }, 400);
    if (reason === "Distributed rate limiter is not configured")
      return response({ error: "ISSUER_UNAVAILABLE" }, 503);
    if (reason === "BROWSER_ORIGIN_REJECTED")
      return response({ error: "BROWSER_ORIGIN_REJECTED" }, 403);
    if (reason === "STARTUP_POLICY_ATTESTATION_REPLAY")
      return response({ error: "INVALID_PROOF" }, 409);
    if (reason.startsWith("STARTUP_ATTESTATION_") ||
        reason.startsWith("STARTUP_ES256_") ||
        reason === "STARTUP_POLICY_SQL_MODE_OR_RELEASE_UNAVAILABLE" ||
        reason.startsWith("ACCOUNT_PRODUCT_SIGNER_"))
      return response({ error: "INVALID_PROOF" }, 403);
    // Private-key/parser/SQL failures must never be reflected to the caller.
    return response({ error: "ISSUER_UNAVAILABLE" }, 503);
  }
}
