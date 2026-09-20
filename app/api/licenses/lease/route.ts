import { NextResponse } from "next/server";
import { z } from "zod";
import { activationSchema } from "@/apps/web/http/validation";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { issueCommercialLease } from "@/apps/web/licensing/commercial-lease";
import { commercialLeaseActions } from "@bke/licensing/logic/lease-lifecycle";
import { CLOUD_AGENT_PROTOCOL_VERSION, requireCloudAgentVersion, validateLifecycleRequest } from "@/apps/web/licensing/cloud-agent-contract";

const schema = activationSchema.extend({ operationId: z.string().min(8).max(128), productVersion: z.string().min(1), action: z.enum(commercialLeaseActions).optional() });

export async function POST(request: Request) {
  try {
    requireCloudAgentVersion(request);
    const parsed = schema.parse(await request.json());
    const input = { ...parsed, action: parsed.action ?? "ACTIVATION" };
    validateLifecycleRequest(input);
    if (!(await rateLimit(`lease:${input.action}:${clientIp(request)}:${input.licenseKey.slice(-4)}`, 20, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    return NextResponse.json(await issueCommercialLease({ ...input, action: input.action ?? "ACTIVATION" }), { status: 201, headers: { "x-bke-licensing-version": CLOUD_AGENT_PROTOCOL_VERSION } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["ACTIVATION_LIMIT", "TRANSFER_NOT_ALLOWED", "INVALID_LICENSE_VERSION", "VERSION_NOT_ELIGIBLE", "VERSION_NOT_ACCEPTED"].includes(message) ? message : "INVALID_LICENSE";
    return NextResponse.json({ error: code }, { status: code === "INVALID_LICENSE" ? 400 : 409 });
  }
}
