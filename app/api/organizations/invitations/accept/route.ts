import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { acceptOrganizationInvitation, expirePendingOrganizationInvitations } from "@/lib/organizations";
const schema = z.object({ token: z.string().min(20) }).strict();
export async function POST(request: Request) { try { assertSameOrigin(request); const user = await requireUser(); const input = schema.parse(await request.json()); await expirePendingOrganizationInvitations(); const membership = await acceptOrganizationInvitation({ userId: user.id, email: user.email, token: input.token }); return NextResponse.json({ accountId: membership.accountId, role: membership.role }); } catch (error) { return apiError(error); } }
