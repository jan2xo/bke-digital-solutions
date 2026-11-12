import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { beginAgentLeaseKeyChallenge } from "./agent-key-proof-authority";
import { issueAgentAccountProductLease } from "./account-product-lease-issuance";
import { smallJson } from "./agent-key-http";
import { nativeAgentBearerToken } from "./native-session";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const SCOPE = /^[A-Za-z0-9._-]{1,128}$/;
const challenge = z.object({
  registration_id: z.string().regex(UUID),
  product_id: z.string().regex(SCOPE),
  action: z.enum(["OPEN", "USE"]),
}).strict();
const issue = z.object({
  challenge_id: z.string().regex(UUID),
  message_base64url: z.string().min(1).max(4096).regex(B64URL),
  signature_base64url: z.string().min(1).max(128).regex(B64URL),
  product_id: z.string().regex(SCOPE),
  action: z.enum(["OPEN", "USE"]),
  platform: z.enum(["windows", "macos", "linux"]),
  architecture: z.enum(["x64", "arm64", "x86"]),
}).strict();

type Operation = "challenge" | "issue";
function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: {
    "cache-control": "no-store",
    "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  } });
}

/**
 * Agent-only disposable/preproduction route. No production path is possible,
 * even if the feature flag is accidentally set. No Google/browser cookies.
 */
export async function agentAccountProductLeaseHttp(request: Request, operation: Operation) {
  try {
    // An invalid production config must still yield 404, not an issuer error.
    if (process.env.DEPLOYMENT_ENV === "production")
      return response({ error: "NOT_FOUND" }, 404);
    const runtime = getRuntimeEnvironment();
    if (runtime.DEPLOYMENT_ENV === "production" ||
        !runtime.AGENT_ACCOUNT_SESSION_ENABLED ||
        !runtime.AGENT_KEY_HTTP_ENABLED ||
        !runtime.ACCOUNT_PRODUCT_LEASE_ISSUANCE_ENABLED) {
      return response({ error: "NOT_FOUND" }, 404);
    }
    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);
    const bearer = nativeAgentBearerToken(request);
    if (!bearer || bearer.length < 32 || bearer.length > 8192)
      return response({ error: "INVALID_TOKEN" }, 401);
    // Source-limited, hashed bearer; neither token nor challenge is a log key.
    const tokenHash = createHash("sha256").update(bearer).digest("hex");
    const ip = clientIp(request);
    const [ipLimit, bearerLimit] = await Promise.all([
      rateLimit("agent-account-lease:" + operation + ":ip:" + ip, 90, 3600),
      rateLimit("agent-account-lease:" + operation + ":token:" + tokenHash, 60, 3600),
    ]);
    if (!ipLimit.allowed || !bearerLimit.allowed)
      return response({ error: "RATE_LIMITED" }, 429);

    const body = await smallJson(request);
    const pepper = runtime.AGENT_ACCOUNT_SESSION_PEPPER!;
    if (operation === "challenge") {
      const parsed = challenge.safeParse(body);
      if (!parsed.success) return response({ error: "INVALID_INPUT" }, 400);
      const result = await db.$transaction(
        (tx) => beginAgentLeaseKeyChallenge(tx, {
          accessToken: bearer, pepper,
          registrationId: parsed.data.registration_id,
          productId: parsed.data.product_id,
          action: parsed.data.action,
        }),
        { isolationLevel: "Serializable", timeout: 10_000 },
      );
      if (result.status !== "challenge") {
        return response({ error: result.reason === "INVALID_TOKEN" ?
          "INVALID_TOKEN" : "INVALID_PROOF" },
          result.reason === "INVALID_TOKEN" ? 401 : 403);
      }
      return response({
        status: "challenge",
        registration_id: result.registrationId,
        challenge_id: result.challengeId,
        message_base64url: result.messageBase64url,
        expires_at: result.expiresAt.toISOString(),
      }, 201);
    }

    const parsed = issue.safeParse(body);
    if (!parsed.success) return response({ error: "INVALID_INPUT" }, 400);
    const result = await issueAgentAccountProductLease({
      accessToken: bearer,
      pepper,
      challengeId: parsed.data.challenge_id,
      messageBase64url: parsed.data.message_base64url,
      signatureBase64url: parsed.data.signature_base64url,
      productId: parsed.data.product_id,
      platform: parsed.data.platform,
      architecture: parsed.data.architecture,
      action: parsed.data.action,
    }, runtime.ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON);
    if (result.status !== "issued")
      return response({ error: result.reason === "INVALID_TOKEN" ?
        "INVALID_TOKEN" : "INVALID_PROOF" },
        result.reason === "INVALID_TOKEN" ? 401 : 403);
    return response({
      status: "issued",
      lease_jws: result.jws,
      kid: result.kid,
      expires_at: result.expiresAt,
      refresh_after: result.refreshAfter,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "PAYLOAD_TOO_LARGE")
      return response({ error: "PAYLOAD_TOO_LARGE" }, 413);
    if (message === "INVALID_INPUT")
      return response({ error: "INVALID_INPUT" }, 400);
    if (message === "Distributed rate limiter is not configured")
      return response({ error: "RATE_LIMITER_UNAVAILABLE" }, 503);
    if (error && typeof error === "object" && "status" in error) {
      const protocol = error as { code?: unknown; status?: unknown };
      if (typeof protocol.code === "string" &&
          (protocol.status === 400 || protocol.status === 403))
        return response({ error: protocol.code }, protocol.status);
    }
    // Never leak signer names, key references, internal DB errors or secret
    // material in the Agent response. No fallback to unsigned/prepared claims.
    return response({ error: "LEASE_ISSUANCE_UNAVAILABLE" }, 503);
  }
}
