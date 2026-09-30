import "server-only";

import { createHmac } from "node:crypto";
import { db } from "@/platform/host/db";
import { env } from "@/platform/host/env";
import { safeEqual } from "@/platform/host/security/crypto";

const HANDLE_PREFIX = "bke-org-invite-v1_";
const HANDLE_DOMAIN = "bke.agent.organization.invitation.management.v1";

function digest(accountId: string, invitationId: string) {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(HANDLE_DOMAIN)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(invitationId)
    .digest("hex");
}

export function issueAgentOrganizationInvitationManagementHandle(
  accountId: string,
  invitationId: string,
) {
  return `${HANDLE_PREFIX}${digest(accountId, invitationId)}`;
}

export function validAgentOrganizationInvitationManagementHandle(
  handle: string,
) {
  return /^bke-org-invite-v1_[0-9a-f]{64}$/.test(handle);
}

export async function resolveAgentOrganizationInvitationManagementHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentOrganizationInvitationManagementHandle(input.handle)) {
    return null;
  }

  const invitations = await db.invitation.findMany({
    where: {
      accountId: input.accountId,
      status: "PENDING",
    },
    select: {
      id: true,
    },
  });

  for (const invitation of invitations) {
    const expected =
      issueAgentOrganizationInvitationManagementHandle(
        input.accountId,
        invitation.id,
      );
    if (safeEqual(expected, input.handle)) {
      return invitation.id;
    }
  }

  return null;
}
