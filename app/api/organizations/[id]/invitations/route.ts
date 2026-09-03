import { NextResponse } from "next/server";
import { z } from "zod";
import {
  expirePendingOrganizationInvitations,
  inviteOrganizationMember,
  listOrganizationInvitations,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
} from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), email: z.string().email(), role: z.enum(["OWNER", "BILLING", "LICENSE_MANAGER", "MEMBER"]) }),
  z.object({ action: z.literal("resend"), invitationId: z.string().cuid() }),
  z.object({ action: z.literal("revoke"), invitationId: z.string().cuid() }),
  z.object({ action: z.literal("expire") }),
]);

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireIdentityUser();
    const { id } = await params;
    return NextResponse.json(await listOrganizationInvitations(principal.id, id));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    const { id } = await params;
    const input = schema.parse(await request.json());
    await expirePendingOrganizationInvitations();
    if (input.action === "create") {
      const result = await inviteOrganizationMember({
        actorId: principal.id,
        accountId: id,
        email: input.email,
        role: input.role,
      });
      return NextResponse.json({ id: result.invitation.id, token: result.token }, { status: 201 });
    }
    if (input.action === "resend") {
      const result = await resendOrganizationInvitation({
        actorId: principal.id,
        invitationId: input.invitationId,
      });
      return NextResponse.json({ id: result.invitation.id, token: result.token });
    }
    if (input.action === "revoke") {
      return NextResponse.json(
        await revokeOrganizationInvitation({ actorId: principal.id, invitationId: input.invitationId }),
      );
    }
    return NextResponse.json(await expirePendingOrganizationInvitations());
  } catch (error) {
    return apiError(error);
  }
}
