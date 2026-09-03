import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { renderLegalMarkdown } from "@/lib/legal/render";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
export async function POST(request: Request) { try { assertSameOrigin(request); await requireAdmin(); const { markdown } = z.object({ markdown: z.string().max(200_000) }).parse(await request.json()); return NextResponse.json({ html: renderLegalMarkdown(markdown) }); } catch (error) { return apiError(error); } }

