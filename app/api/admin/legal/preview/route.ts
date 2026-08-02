import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { renderLegalMarkdown } from "@/lib/legal/render";
import { assertSameOrigin } from "@/lib/security/request";
export async function POST(request: Request) { try { assertSameOrigin(request); await requireAdmin(); const { markdown } = z.object({ markdown: z.string().max(200_000) }).parse(await request.json()); return NextResponse.json({ html: renderLegalMarkdown(markdown) }); } catch (error) { return apiError(error); } }

