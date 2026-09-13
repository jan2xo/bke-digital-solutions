import "server-only";

import {
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  type PrivacyRequestStatus,
  type PrivacyRequestTransitionStatus,
  type PrivacyRequestType,
} from "@bke/privacy/contracts/privacy-request-policy.contract";
import {
  normalizePrivacyRequestNetworkSnapshot,
  normalizePrivacyRequestType,
  planPrivacyRequestCreation,
  planPrivacyRequestTransition,
} from "@bke/privacy/logic/privacy-request-policy";
import { db } from "@/v2/platform/host/db";
import { clientIp } from "@/v2/platform/host/security/request";

export { PRIVACY_REQUEST_STATUSES, PRIVACY_REQUEST_TYPES, normalizePrivacyRequestType };
export type { PrivacyRequestStatus, PrivacyRequestTransitionStatus, PrivacyRequestType };

export function publicPrivacyRequestSnapshot(request: Request) {
  return normalizePrivacyRequestNetworkSnapshot({
    ipAddress: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });
}

export async function createPrivacyRequest(input: {
  userId: string;
  accountId?: string | null;
  requestType: PrivacyRequestType;
  summary: string;
  request: Request;
}) {
  const plan = planPrivacyRequestCreation({
    userId: input.userId,
    accountId: input.accountId,
    requestType: input.requestType,
    summary: input.summary,
    network: publicPrivacyRequestSnapshot(input.request),
  });

  return db.$transaction(async (tx) => {
    const privacyRequest = await tx.privacyRequest.create({
      data: {
        userId: plan.request.userId,
        customerAccountId: plan.request.accountId,
        requestType: plan.request.requestType,
        status: plan.request.status,
        summary: plan.request.summary,
        ipAddress: plan.request.ipAddress,
        userAgent: plan.request.userAgent,
      },
    });
    await tx.privacyRequestEvent.create({
      data: {
        privacyRequestId: privacyRequest.id,
        actorId: plan.event.actorId,
        eventType: plan.event.eventType,
        toStatus: plan.event.toStatus,
        metadata: { ...plan.event.metadata },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: plan.audit.actorId,
        accountId: plan.audit.accountId ?? undefined,
        action: plan.audit.action,
        targetType: plan.audit.targetType,
        targetId: privacyRequest.id,
        metadata: { ...plan.audit.metadata },
      },
    });
    return privacyRequest;
  });
}

export async function transitionPrivacyRequest(input: {
  actorId: string;
  requestId: string;
  status: PrivacyRequestTransitionStatus;
  responseSummary: string;
}) {
  return db.$transaction(async (tx) => {
    const current = await tx.privacyRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    const plan = planPrivacyRequestTransition({
      actorId: input.actorId,
      accountId: current.customerAccountId,
      currentStatus: current.status,
      targetStatus: input.status,
      responseSummary: input.responseSummary,
    });
    const now = new Date();
    const updated = await tx.privacyRequest.update({
      where: { id: input.requestId },
      data: {
        status: plan.update.status,
        responseSummary: plan.update.responseSummary,
        reviewedById: plan.update.reviewedById,
        reviewedAt: now,
        closedAt: plan.update.shouldClose ? now : null,
      },
    });
    await tx.privacyRequestEvent.create({
      data: {
        privacyRequestId: input.requestId,
        actorId: plan.event.actorId,
        eventType: plan.event.eventType,
        fromStatus: plan.event.fromStatus,
        toStatus: plan.event.toStatus,
        metadata: { ...plan.event.metadata },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: plan.audit.actorId,
        accountId: plan.audit.accountId ?? undefined,
        action: plan.audit.action,
        targetType: plan.audit.targetType,
        targetId: input.requestId,
        metadata: { ...plan.audit.metadata },
      },
    });
    return updated;
  });
}
