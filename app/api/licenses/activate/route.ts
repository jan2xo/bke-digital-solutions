import { NextResponse } from "next/server";
import { z } from "zod";
import { activationSchema } from "@/lib/validation";
import { clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { issueCommercialLease } from "@/lib/licensing/commercial-lease";
import { CLOUD_AGENT_PROTOCOL_VERSION, requireCloudAgentVersion } from "@/lib/licensing/cloud-agent-contract";

const schema = activationSchema.extend({ operationId: z.string().min(8).max(128) });

export async function POST(request: Request) {
  try {
    requireCloudAgentVersion(request);
    const input = schema.parse(await request.json());
    if (!(await rateLimit(`activate:${clientIp(request)}:${input.licenseKey.slice(-4)}`, 20, 3600)).allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    return NextResponse.json(await issueCommercialLease({ ...input, action: "ACTIVATION" }), { status: 201, headers: { "x-bke-licensing-version": CLOUD_AGENT_PROTOCOL_VERSION } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = ["ACTIVATION_LIMIT", "INVALID_LICENSE_VERSION", "VERSION_NOT_ACCEPTED", "COMMERCIAL_OPERATION_REQUIRED"].includes(message) ? message : "INVALID_LICENSE";
    return NextResponse.json({ error: code }, { status: code === "INVALID_LICENSE" ? 400 : 409 });
  }
}
