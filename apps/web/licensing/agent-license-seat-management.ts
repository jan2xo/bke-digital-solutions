import "server-only";

import { createHmac } from "node:crypto";
import { db } from "@/platform/host/db";
import { env } from "@/platform/host/env";
import { safeEqual } from "@/platform/host/security/crypto";

const LICENSE_HANDLE_PREFIX = "bke-license-seat-v1_";
const LICENSE_HANDLE_DOMAIN =
  "bke.agent.license-seat.management.v1";
const TARGET_HANDLE_PREFIX = "bke-license-seat-user-v1_";
const TARGET_HANDLE_DOMAIN =
  "bke.agent.license-seat.target.v1";

function licenseDigest(
  accountId: string,
  licenseId: string,
  createdAt: Date | string,
) {
  const createdAtValue =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : createdAt;

  return createHmac("sha256", env.SESSION_SECRET)
    .update(LICENSE_HANDLE_DOMAIN)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(licenseId)
    .update("\0")
    .update(createdAtValue)
    .digest("hex");
}

function targetDigest(
  accountId: string,
  userId: string,
) {
  return createHmac("sha256", env.SESSION_SECRET)
    .update(TARGET_HANDLE_DOMAIN)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(userId)
    .digest("hex");
}

export function issueAgentLicenseSeatManagementHandle(
  accountId: string,
  licenseId: string,
  createdAt: Date | string,
) {
  return `${LICENSE_HANDLE_PREFIX}${licenseDigest(
    accountId,
    licenseId,
    createdAt,
  )}`;
}

export function validAgentLicenseSeatManagementHandle(
  handle: string,
) {
  return /^bke-license-seat-v1_[0-9a-f]{64}$/.test(
    handle,
  );
}

export async function resolveAgentLicenseSeatManagementHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentLicenseSeatManagementHandle(input.handle)) {
    return null;
  }

  const licenses = await db.license.findMany({
    where: { accountId: input.accountId },
    select: {
      id: true,
      createdAt: true,
    },
  });

  for (const license of licenses) {
    const expected = issueAgentLicenseSeatManagementHandle(
      input.accountId,
      license.id,
      license.createdAt,
    );
    if (safeEqual(expected, input.handle)) {
      return license.id;
    }
  }

  return null;
}

export function issueAgentLicenseSeatTargetHandle(
  accountId: string,
  userId: string,
) {
  return `${TARGET_HANDLE_PREFIX}${targetDigest(
    accountId,
    userId,
  )}`;
}

export function validAgentLicenseSeatTargetHandle(
  handle: string,
) {
  return /^bke-license-seat-user-v1_[0-9a-f]{64}$/.test(
    handle,
  );
}

export async function resolveAgentLicenseSeatTargetHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentLicenseSeatTargetHandle(input.handle)) {
    return null;
  }

  const account = await db.customerAccount.findUnique({
    where: { id: input.accountId },
    select: {
      owner: {
        select: {
          id: true,
          lifecycleState: true,
          emailVerified: true,
        },
      },
      memberships: {
        select: {
          user: {
            select: {
              id: true,
              lifecycleState: true,
              emailVerified: true,
            },
          },
        },
      },
    },
  });

  if (!account) {
    return null;
  }

  const users = [
    account.owner,
    ...account.memberships.map(
      (membership) => membership.user,
    ),
  ].filter(
    (user, index, all) =>
      user.lifecycleState === "ACTIVE" &&
      Boolean(user.emailVerified) &&
      all.findIndex(
        (candidate) => candidate.id === user.id,
      ) === index,
  );

  for (const user of users) {
    const expected = issueAgentLicenseSeatTargetHandle(
      input.accountId,
      user.id,
    );
    if (safeEqual(expected, input.handle)) {
      return user.id;
    }
  }

  return null;
}
