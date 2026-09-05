import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { revokeProviderCredentials, safeProviderStatuses, saveProviderConfiguration, setProviderState, validateProviderConfiguration } from "@/v2/apps/web/providers/capability";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

const provider = z.enum(["PAYMONGO", "RESEND"]);
const environment = z.enum(["TEST", "LIVE"]);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE"), provider, environment, secretKey: z.string().trim().min(8).max(500).optional(), webhookSecret: z.string().trim().min(8).max(500).optional(), apiKey: z.string().trim().min(8).max(500).optional(), senderName: z.string().trim().min(1).max(100).optional(), senderEmail: z.email().optional(), supportEmail: z.email().optional() }),
  z.object({ action: z.enum(["VALIDATE", "ENABLE", "DISABLE", "REVOKE"]), provider, environment }),
]);

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(await safeProviderStatuses(), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const limited = await rateLimit(`admin-provider:${admin.id}:${clientIp(request)}`, 20, 3600);
    if (!limited.allowed) throw new Error("RATE_LIMITED");
    const input = requestSchema.parse(await request.json());
    if (input.action === "SAVE") {
      const secrets = input.provider === "PAYMONGO" ? { SECRET_KEY: input.secretKey, WEBHOOK_SECRET: input.webhookSecret } : { API_KEY: input.apiKey };
      await saveProviderConfiguration({ actorId: admin.id, provider: input.provider, environment: input.environment, secrets, senderName: input.senderName, senderEmail: input.senderEmail, supportEmail: input.supportEmail });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "VALIDATE") return NextResponse.json(await validateProviderConfiguration({ actorId: admin.id, provider: input.provider, environment: input.environment }));
    if (input.action === "REVOKE") await revokeProviderCredentials({ actorId: admin.id, provider: input.provider, environment: input.environment });
    else await setProviderState({ actorId: admin.id, provider: input.provider, environment: input.environment, enabled: input.action === "ENABLE" });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
