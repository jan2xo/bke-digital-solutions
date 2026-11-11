import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  beginAgentKeyEnrollment,
  verifyAgentKeyChallenge,
  revokeAgentLeaseKey,
} from "@/apps/web/agent-sessions/agent-key-proof-authority";
import { readAgentKeyRegistrationState } from "@/apps/web/agent-sessions/agent-key-reconciliation";
import { nativeAgentBearerToken } from "@/apps/web/agent-sessions/native-session";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { apiError } from "@/apps/web/http/api-error";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

/** Narrow public Agent enrollment adapter. No JWS signer or LEASE endpoint. */
export type AgentKeyHttpOperation = "enroll" | "verify" | "revoke" | "status";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const enrollSchema = z.object({
  public_key_pem: z.string().min(60).max(4096),
  device_code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
const verifySchema = z.object({
  challenge_id: z.string().regex(UUID),
  message_base64url: z.string().min(1).max(4096).regex(B64URL),
  signature_base64url: z.string().min(1).max(128).regex(B64URL),
}).strict();
const revokeSchema = z.object({
  registration_id: z.string().regex(UUID),
}).strict();
const statusSchema = z.object({ registration_id: z.string().regex(UUID).optional() }).strict();

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

async function smallJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;.*)?$/i.test(type)) {
    throw new Error("INVALID_INPUT");
  }
  const sizeHeader = request.headers.get("content-length");
  if (sizeHeader && (!/^\d+$/.test(sizeHeader) || Number(sizeHeader) > 8192)) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  if (!request.body) throw new Error("INVALID_INPUT");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("INVALID_INPUT");
  }
}

async function limited(request: Request, operation: AgentKeyHttpOperation, bearer: string) {
  // A stolen bearer remains a risk: rate limiting does not attest an installed Agent.
  // Existing distributed rateLimit fails closed on unavailable Redis in production.
  const ip = clientIp(request);
  const tokenHash = createHash("sha256").update(bearer).digest("hex");
  const hourly = operation === "enroll" ? 12 : operation === "revoke" ? 24 : operation === "status" ? 60 : 120;
  const perToken = operation === "enroll" ? 8 : operation === "revoke" ? 16 : operation === "status" ? 60 : 80;
  const first = await rateLimit("agent-key:" + operation + ":ip:" + ip, hourly, 3600);
  const second = await rateLimit(
    "agent-key:" + operation + ":bearer:" + tokenHash, perToken, 3600);
  return first.allowed && second.allowed;
}

function denied(reason: string) {
  switch (reason) {
    case "INVALID_TOKEN":
      return response({ error: "INVALID_TOKEN" }, 401);
    case "REGISTRATION_CONFLICT":
      return response({ error: "REGISTRATION_CONFLICT" }, 409);
    case "KEY_REVOKED":
      return response({ error: "KEY_REVOKED" }, 409);
    case "INVALID_KEY":
    case "INVALID_SCOPE":
      return response({ error: "INVALID_INPUT" }, 400);
    default:
      return response({ error: "INVALID_PROOF" }, 403);
  }
}

export async function agentKeyHttp(request: Request, operation: AgentKeyHttpOperation) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return response({ error: "NOT_FOUND" }, 404);
    }
    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const bearer = nativeAgentBearerToken(request);
    if (!bearer || bearer.length < 32 || bearer.length > 8192) {
      return response({ error: "INVALID_TOKEN" }, 401);
    }
    if (!(await limited(request, operation, bearer))) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const body = await smallJson(request);
    const pepper = runtime.AGENT_ACCOUNT_SESSION_PEPPER!;

    if (operation === "enroll") {
      const parsed = enrollSchema.safeParse(body);
      if (!parsed.success) return response({ error: "INVALID_INPUT" }, 400);
      const result = await db.$transaction(
        (tx) => beginAgentKeyEnrollment(tx, {
          accessToken: bearer,
          pepper,
          publicKeyPem: parsed.data.public_key_pem,
          deviceCode: parsed.data.device_code,
        }),
        { isolationLevel: "Serializable" },
      );
      if (result.status === "denied") return denied(result.reason);
      return response({
        status: "challenge",
        registration_id: result.registrationId,
        challenge_id: result.challengeId,
        message_base64url: result.messageBase64url,
        expires_at: result.expiresAt.toISOString(),
      }, 201);
    }

    if (operation === "verify") {
      const parsed = verifySchema.safeParse(body);
      if (!parsed.success) return response({ error: "INVALID_INPUT" }, 400);
      const result = await db.$transaction(async (tx) => {
        // Public verify accepts ENROLL only. Product LEASE proof remains internal
        // until eligible, audited, transactional JWS issuance is implemented.
        const rows = await tx.$queryRaw<Array<{ purpose: string }>>`
          SELECT "purpose" FROM "AgentLeaseKeyChallenge"
           WHERE "id" = ${parsed.data.challenge_id}
        `;
        if (rows[0]?.purpose !== "ENROLL") {
          return { status: "denied" as const, reason: "INVALID_CHALLENGE" as const };
        }
        return verifyAgentKeyChallenge(tx, {
          accessToken: bearer,
          pepper,
          challengeId: parsed.data.challenge_id,
          messageBase64url: parsed.data.message_base64url,
          signatureBase64url: parsed.data.signature_base64url,
        });
      }, { isolationLevel: "Serializable" });
      if (result.status === "denied") return denied(result.reason);
      if (result.status !== "enrolled") return response({ error: "INVALID_PROOF" }, 403);
      return response({ status: "enrolled", registration_id: result.registrationId });
    }

    if (operation === "status") {
      const parsed = statusSchema.safeParse(body);
      if (!parsed.success) return response({ error: "INVALID_INPUT" }, 400);
      const result = await db.$transaction(
        (tx) => readAgentKeyRegistrationState(tx, {
          accessToken: bearer, pepper, registrationId: parsed.data.registration_id,
        }),
        { isolationLevel: "Serializable" },
      );
      if (result.status === "denied") return denied(result.reason);
      if (result.status === "none") return response({ status: "none" });
      return response({
        status: "registration", registration_id: result.registrationId,
        registration_state: result.registrationState,
        key_thumbprint: result.keyThumbprint,
        // Only DS persisted SPKI verification defines the algorithm; never client input.
        key_algorithm: result.keyAlgorithm,
        key_protection: result.keyProtection,
        valid_until: result.validUntil.toISOString(),
      });
    }

    const parsed = revokeSchema.safeParse(body);
    if (!parsed.success) return response({ error: "INVALID_INPUT" }, 400);
    const result = await db.$transaction(
      (tx) => revokeAgentLeaseKey(tx, {
        accessToken: bearer,
        pepper,
        registrationId: parsed.data.registration_id,
      }),
      { isolationLevel: "Serializable" },
    );
    if (result.status === "denied") return denied(result.reason);
    return response({ status: result.status });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INVALID_INPUT" || code === "PAYLOAD_TOO_LARGE") {
      return response({ error: code }, code === "PAYLOAD_TOO_LARGE" ? 413 : 400);
    }
    if (code === "Distributed rate limiter is not configured") {
      return response({ error: "RATE_LIMITER_UNAVAILABLE" }, 503);
    }
    const fallback = apiError(error);
    fallback.headers.set("cache-control", "no-store");
    fallback.headers.set("x-bke-account-session-version", AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION);
    return fallback;
  }
}
