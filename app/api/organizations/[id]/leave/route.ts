import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { leaveOrganization } from "@/lib/organizations";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const actor = await requireUser(); const { id } = await params; await leaveOrganization({ actorId: actor.id, accountId: id }); return NextResponse.json({ ok: true }); } catch (error) { return apiError(error); } }
