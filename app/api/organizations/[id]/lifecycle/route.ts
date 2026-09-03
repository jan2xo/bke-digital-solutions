import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { closeOrganization } from "@/lib/organizations";
const schema = z.object({ action: z.literal("close") }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const actor = await requireUser(); const { id } = await params; schema.parse(await request.json()); return NextResponse.json(await closeOrganization({ actorId: actor.id, accountId: id })); } catch (error) { return apiError(error); } }
