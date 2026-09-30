import "server-only";

import { createHmac } from "node:crypto";
import { db } from "@/platform/host/db";
import { env } from "@/platform/host/env";
import { safeEqual } from "@/platform/host/security/crypto";

const HANDLE_PREFIX = "bke-org-member-v1_";
const HANDLE_DOMAIN = "bke.agent.organization.member.management.v1";

function digest(
  accountId: string,
  userId: string,
  createdAt: Date | string,
) {
  const createdAtValue =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : createdAt;
  return createHmac("sha256", env.SESSION_SECRET)
    .update(HANDLE_DOMAIN)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(userId)
    .update("\0")
    .update(createdAtValue)
    .digest("hex");
}

export function issueAgentOrganizationMemberManagementHandle(
  accountId: string,
  userId: string,
  createdAt: Date | string,
) {
  return `${HANDLE_PREFIX}${digest(
    accountId,
    userId,
    createdAt,
  )}`;
}

export function validAgentOrganizationMemberManagementHandle(
  handle: string,
) {
  return /^bke-org-member-v1_[0-9a-f]{64}$/.test(handle);
}

export async function resolveAgentOrganizationMemberManagementHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentOrganizationMemberManagementHandle(input.handle)) {
    return null;
  }

  const memberships = await db.membership.findMany({
    where: { accountId: input.accountId },
    select: {
      userId: true,
      createdAt: true,
    },
  });

  for (const membership of memberships) {
    const expected =
      issueAgentOrganizationMemberManagementHandle(
        input.accountId,
        membership.userId,
        membership.createdAt,
      );
    if (safeEqual(expected, input.handle)) {
      return membership.userId;
    }
  }

  return null;
}
