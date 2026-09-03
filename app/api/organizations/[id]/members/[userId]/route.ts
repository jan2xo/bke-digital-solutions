import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { removeOrganizationMember, updateOrganizationMemberRole } from "@/lib/organizations";
const schema = z.object({ role: z.enum(["OWNER", "BILLING", "LICENSE_MANAGER", "MEMBER"]) }).strict();
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) { try { assertSameOrigin(request); const actor = await requireUser(); const { id, userId } = await params; const input = schema.parse(await request.json()); return NextResponse.json(await updateOrganizationMemberRole({ actorId: actor.id, accountId: id, userId, role: input.role })); } catch (error) { return apiError(error); } }
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) { try { assertSameOrigin(request); const actor = await requireUser(); const { id, userId } = await params; await removeOrganizationMember({ actorId: actor.id, accountId: id, userId }); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
