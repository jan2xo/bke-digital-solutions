import { NextResponse } from "next/server";
import { z } from "zod";
import { activationSchema } from "@/v2/apps/web/http/validation";
import { clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { issueCommercialLease } from "@/lib/licensing/commercial-lease";
import { CLOUD_AGENT_PROTOCOL_VERSION, requireCloudAgentVersion } from "@/v2/apps/web/licensing/cloud-agent-contract";
import { audit } from "@/lib/audit";

const schema = activationSchema.extend({ operationId: z.string().min(8).max(128), productVersion: z.string().min(1) });
type ActivationInput = z.infer<typeof schema>;

function hint(value: string | undefined, length = 8) {
  return value ? value.slice(-length) : undefined;
}

async function observe(input: {
  requestId: string;
  result: "ALLOW" | "DENY";
  reason: string;
  durationMs: number;
  activation?: Partial<ActivationInput>;
}) {
  const metadata = {
    requestId: input.requestId,
    protocol: CLOUD_AGENT_PROTOCOL_VERSION,
    result: input.result,
    reason: input.reason,
    durationMs: input.durationMs,
    productVersion: input.activation?.productVersion,
    operationId: input.activation?.operationId,
    installationHint: hint(input.activation?.installationId),
    deviceHint: hint(input.activation?.deviceId),
    licenseKeySuffix: hint(input.activation?.licenseKey, 4),
  };

  const line = `[LICENSING] ${input.result} reason=${input.reason} request=${input.requestId} version=${metadata.productVersion ?? "?"} installation=…${metadata.installationHint ?? "?"} device=…${metadata.deviceHint ?? "?"} duration_ms=${input.durationMs}`;
  if (input.result === "ALLOW") console.info(line);
  else console.warn(line);

  try {
    await audit({
      action: `LICENSING_ACTIVATION_${input.result}`,
      targetType: "LICENSING_ACTIVATION",
      targetId: input.activation?.operationId ?? input.requestId,
      metadata,
    });
  } catch (auditError) {
    console.error("[LICENSING] observability persistence failed", auditError);
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = request.headers.get("x-request-id") ?? "missing-request-id";
  let input: ActivationInput | undefined;

  try {
    requireCloudAgentVersion(request);
    input = schema.parse(await request.json());

    if (!(await rateLimit(`activate:${clientIp(request)}:${input.licenseKey.slice(-4)}`, 20, 3600)).allowed) {
      await observe({ requestId, result: "DENY", reason: "RATE_LIMITED", durationMs: Date.now() - startedAt, activation: input });
      return NextResponse.json({ error: "RATE_LIMITED", requestId }, { status: 429 });
    }

    const response = await issueCommercialLease({ ...input, action: "ACTIVATION" });
    await observe({ requestId, result: "ALLOW", reason: "LEASE_ISSUED", durationMs: Date.now() - startedAt, activation: input });
    return NextResponse.json(response, { status: 201, headers: { "x-bke-licensing-version": CLOUD_AGENT_PROTOCOL_VERSION, "x-request-id": requestId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["ACTIVATION_LIMIT", "INVALID_LICENSE_VERSION", "VERSION_NOT_ELIGIBLE", "VERSION_NOT_ACCEPTED", "COMMERCIAL_OPERATION_REQUIRED"].includes(message) ? message : "INVALID_LICENSE";
    await observe({ requestId, result: "DENY", reason: code, durationMs: Date.now() - startedAt, activation: input });
    return NextResponse.json({ error: code, requestId }, { status: code === "INVALID_LICENSE" ? 400 : 409, headers: { "x-request-id": requestId } });
  }
}
