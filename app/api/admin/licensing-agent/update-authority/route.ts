import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/apps/web/auth/session";
import { assertSameOrigin } from "@/apps/web/http/request";
import { apiError } from "@/apps/web/http/api-error";
import { rateLimit } from "@/apps/web/http/rate-limit";
import {
  activateLicensingAgentUpdateKey,
  activateLicensingAgentUpdateRelease,
  deactivateLicensingAgentUpdateRelease,
  getLicensingAgentUpdateAuthorityState,
  registerLicensingAgentUpdateKey,
  registerLicensingAgentUpdateRelease,
  retireLicensingAgentUpdateKey,
} from "@/apps/web/distribution/licensing-agent-update-admin";

const semanticVersion = z.string().trim().regex(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
);
const operationId = z.string().uuid();
const keyId = z.string().trim().regex(/^[A-Za-z0-9._-]{1,64}$/);
const recordId = z.string().uuid();

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("REGISTER_KEY"),
    operationId,
    keyId,
    publicKey: z.string().trim().min(40).max(128),
    trustedFromVersion: semanticVersion,
  }).strict(),
  z.object({
    action: z.literal("ACTIVATE_KEY"),
    operationId,
    keyId,
  }).strict(),
  z.object({
    action: z.literal("RETIRE_KEY"),
    operationId,
    keyId,
  }).strict(),
  z.object({
    action: z.literal("REGISTER_RELEASE"),
    operationId,
    version: semanticVersion,
    minimumSupportedVersion: semanticVersion,
    revision: z.number().int().positive(),
  }).strict(),
  z.object({
    action: z.literal("ACTIVATE_RELEASE"),
    operationId,
    releaseId: recordId,
  }).strict(),
  z.object({
    action: z.literal("DEACTIVATE_RELEASE"),
    operationId,
    releaseId: recordId,
  }).strict(),
]);

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(
      await getLicensingAgentUpdateAuthorityState(),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (
      !(await rateLimit(
        `admin-agent-update-authority:${admin.id}`,
        40,
        3600,
      )).allowed
    ) {
      throw new Error("RATE_LIMITED");
    }
    const input = requestSchema.parse(await request.json());

    const result = input.action === "REGISTER_KEY"
      ? await registerLicensingAgentUpdateKey({
          actorId: admin.id,
          operationId: input.operationId,
          keyId: input.keyId,
          publicKey: input.publicKey,
          trustedFromVersion: input.trustedFromVersion,
        })
      : input.action === "ACTIVATE_KEY"
        ? await activateLicensingAgentUpdateKey({
            actorId: admin.id,
            operationId: input.operationId,
            keyId: input.keyId,
          })
        : input.action === "RETIRE_KEY"
          ? await retireLicensingAgentUpdateKey({
              actorId: admin.id,
              operationId: input.operationId,
              keyId: input.keyId,
            })
          : input.action === "REGISTER_RELEASE"
            ? await registerLicensingAgentUpdateRelease({
                actorId: admin.id,
                operationId: input.operationId,
                version: input.version,
                minimumSupportedVersion: input.minimumSupportedVersion,
                revision: input.revision,
              })
            : input.action === "ACTIVATE_RELEASE"
              ? await activateLicensingAgentUpdateRelease({
                  actorId: admin.id,
                  operationId: input.operationId,
                  releaseId: input.releaseId,
                })
              : await deactivateLicensingAgentUpdateRelease({
                  actorId: admin.id,
                  operationId: input.operationId,
                  releaseId: input.releaseId,
                });

    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
