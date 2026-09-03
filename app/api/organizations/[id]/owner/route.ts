import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { transferOrganizationOwnership } from "@/lib/organizations";
const schema = z.object({ newOwnerUserId: z.string().cuid() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const actor = await requireUser(); const { id } = await params; const input = schema.parse(await request.json()); return NextResponse.json(await transferOrganizationOwnership({ actorId: actor.id, accountId: id, newOwnerUserId: input.newOwnerUserId })); } catch (error) { return apiError(error); } }
