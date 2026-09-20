import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { renderLegalMarkdown } from "@/apps/web/legal/render";
import { assertSameOrigin } from "@/apps/web/http/request";
export async function POST(request: Request) { try { assertSameOrigin(request); await requireAdmin(); const { markdown } = z.object({ markdown: z.string().max(200_000) }).parse(await request.json()); return NextResponse.json({ html: renderLegalMarkdown(markdown) }); } catch (error) { return apiError(error); } }

