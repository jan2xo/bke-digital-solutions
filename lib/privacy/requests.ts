import "server-only";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/security/request";

export const PRIVACY_REQUEST_TYPES = ["ACCESS", "CORRECTION", "EXPORT", "DELETION", "RESTRICTION", "OBJECTION", "BREACH_REPORT"] as const;
export type PrivacyRequestType = typeof PRIVACY_REQUEST_TYPES[number];

export function normalizePrivacyRequestType(value: string): PrivacyRequestType {
  if ((PRIVACY_REQUEST_TYPES as readonly string[]).includes(value)) return value as PrivacyRequestType;
  throw new Error("INVALID_PRIVACY_REQUEST_TYPE");
}

export function publicPrivacyRequestSnapshot(request: Request) {
  return {
    ipAddress: clientIp(request).slice(0, 128),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  };
}

export async function createPrivacyRequest(input: { userId: string; accountId?: string | null; requestType: PrivacyRequestType; summary: string; request: Request }) {
  const network = publicPrivacyRequestSnapshot(input.request);
  return db.$transaction(async (tx) => {
    const privacyRequest = await tx.privacyRequest.create({
      data: {
        userId: input.userId,
        customerAccountId: input.accountId ?? null,
        requestType: input.requestType,
        status: "OPEN",
        summary: input.summary.slice(0, 2_000),
        ipAddress: network.ipAddress,
        userAgent: network.userAgent,
      },
    });
    await tx.auditLog.create({ data: { actorId: input.userId, accountId: input.accountId ?? undefined, action: "PRIVACY_REQUEST_CREATED", targetType: "PrivacyRequest", targetId: privacyRequest.id, metadata: { requestType: input.requestType } } });
    return privacyRequest;
  });
}

export async function transitionPrivacyRequest(input: { actorId: string; requestId: string; status: "IN_REVIEW" | "FULFILLED" | "REJECTED" | "CANCELLED"; responseSummary: string }) {
  return db.$transaction(async (tx) => {
    const current = await tx.privacyRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    if (["FULFILLED", "REJECTED", "CANCELLED"].includes(current.status)) throw new Error("PRIVACY_REQUEST_CLOSED");
    if (input.status === "FULFILLED" && input.responseSummary.trim().length < 10) throw new Error("PRIVACY_RESPONSE_REQUIRED");
    const updated = await tx.privacyRequest.update({ where: { id: input.requestId }, data: { status: input.status, responseSummary: input.responseSummary.slice(0, 2_000), reviewedById: input.actorId, reviewedAt: new Date(), closedAt: ["FULFILLED", "REJECTED", "CANCELLED"].includes(input.status) ? new Date() : null } });
    await tx.auditLog.create({ data: { actorId: input.actorId, accountId: current.customerAccountId ?? undefined, action: "PRIVACY_REQUEST_STATUS_CHANGED", targetType: "PrivacyRequest", targetId: input.requestId, metadata: { from: current.status, to: input.status } } });
    return updated;
  });
}
