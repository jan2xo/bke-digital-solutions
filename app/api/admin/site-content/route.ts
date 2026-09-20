import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/apps/web/auth/session";
import { assertSameOrigin } from "@/apps/web/http/request";
import { apiError } from "@/apps/web/http/api-error";
import { getSiteContent, resetSiteContent, saveSiteContent, siteContentInput } from "@/apps/web/site-content";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SAVE"), values: siteContentInput.shape.values }),
  z.object({ action: z.literal("RESET") }),
]);
export async function GET() { try { await requireAdmin(); return NextResponse.json(await getSiteContent(), { headers: { "cache-control": "no-store" } }); } catch (error) { return apiError(error); } }
export async function POST(request: Request) { try { assertSameOrigin(request); const admin = await requireRecentAdmin(); const input = requestSchema.parse(await request.json()); if (input.action === "RESET") await resetSiteContent(admin.id); else await saveSiteContent(admin.id, input.values as never); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
