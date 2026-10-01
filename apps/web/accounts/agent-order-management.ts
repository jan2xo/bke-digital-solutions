import "server-only";

import { createHmac } from "node:crypto";
import { db } from "@/platform/host/db";
import { env } from "@/platform/host/env";
import { safeEqual } from "@/platform/host/security/crypto";

const CONTINUE_HANDLE_PREFIX = "bke-order-continue-v1_";
const CONTINUE_HANDLE_DOMAIN =
  "bke.agent.order.continue.v1";
const CANCEL_HANDLE_PREFIX = "bke-order-cancel-v1_";
const CANCEL_HANDLE_DOMAIN =
  "bke.agent.order.cancel.v1";

function digest(
  domain: string,
  accountId: string,
  orderId: string,
  createdAt: Date | string,
) {
  const createdAtValue =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : createdAt;

  return createHmac("sha256", env.SESSION_SECRET)
    .update(domain)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(orderId)
    .update("\0")
    .update(createdAtValue)
    .digest("hex");
}

export function issueAgentOrderContinueHandle(
  accountId: string,
  orderId: string,
  createdAt: Date | string,
) {
  return `${CONTINUE_HANDLE_PREFIX}${digest(
    CONTINUE_HANDLE_DOMAIN,
    accountId,
    orderId,
    createdAt,
  )}`;
}

export function validAgentOrderContinueHandle(
  handle: string,
) {
  return /^bke-order-continue-v1_[0-9a-f]{64}$/.test(
    handle,
  );
}

export async function resolveAgentOrderContinueHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentOrderContinueHandle(input.handle)) {
    return null;
  }

  const orders = await db.order.findMany({
    where: {
      accountId: input.accountId,
      status: "PENDING",
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  for (const order of orders) {
    const expected = issueAgentOrderContinueHandle(
      input.accountId,
      order.id,
      order.createdAt,
    );
    if (safeEqual(expected, input.handle)) {
      return order.id;
    }
  }

  return null;
}

export function issueAgentOrderCancelHandle(
  accountId: string,
  orderId: string,
  createdAt: Date | string,
) {
  return `${CANCEL_HANDLE_PREFIX}${digest(
    CANCEL_HANDLE_DOMAIN,
    accountId,
    orderId,
    createdAt,
  )}`;
}

export function validAgentOrderCancelHandle(
  handle: string,
) {
  return /^bke-order-cancel-v1_[0-9a-f]{64}$/.test(
    handle,
  );
}

export async function resolveAgentOrderCancelHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentOrderCancelHandle(input.handle)) {
    return null;
  }

  const orders = await db.order.findMany({
    where: {
      accountId: input.accountId,
      status: "PENDING",
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  for (const order of orders) {
    const expected = issueAgentOrderCancelHandle(
      input.accountId,
      order.id,
      order.createdAt,
    );
    if (safeEqual(expected, input.handle)) {
      return order.id;
    }
  }

  return null;
}
