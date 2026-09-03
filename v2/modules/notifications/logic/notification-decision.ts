import type {
  DecideNotificationInput,
  DecideNotificationResult,
  NotificationAudience,
  NotificationPlan,
  NotificationsDecisionCapability,
} from "../contracts/notification-decision.contract";

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function audienceIdentity(audience: NotificationAudience): string | null {
  switch (audience.kind) {
    case "USER":
      return nonBlank(audience.userId) ? `user:${audience.userId.trim()}` : null;
    case "ACCOUNT":
      return nonBlank(audience.accountId) ? `account:${audience.accountId.trim()}` : null;
    case "SEGMENT":
      return nonBlank(audience.segmentId) ? `segment:${audience.segmentId.trim()}` : null;
    case "ALL_USERS":
      return "all-users";
    case "ALL_ACTIVE_CLIENTS":
      return "all-active-clients";
    case "VISITOR":
      if (audience.visitorId === undefined || audience.visitorId === null) return "visitor:anonymous";
      return nonBlank(audience.visitorId) ? `visitor:${audience.visitorId.trim()}` : null;
  }
}

function invalid(input: DecideNotificationInput): boolean {
  if (!nonBlank(input.notificationKey)) return true;
  if (!nonBlank(input.content.title) || !nonBlank(input.content.body)) return true;
  if (!validDate(input.context.now)) return true;
  if (!audienceIdentity(input.audience)) return true;
  if (input.trigger.kind === "EVENT" && !nonBlank(input.trigger.eventName)) return true;
  if (input.rules?.expiresAt && !validDate(input.rules.expiresAt)) return true;
  if (input.dedupeKey !== undefined && input.dedupeKey !== null && !nonBlank(input.dedupeKey)) return true;
  return false;
}

export function decideNotification(input: DecideNotificationInput): DecideNotificationResult {
  if (invalid(input)) return { status: "DO_NOT_NOTIFY", reason: "INVALID_INPUT" };

  if (input.rules?.expiresAt && input.context.now.getTime() >= input.rules.expiresAt.getTime()) {
    return { status: "DO_NOT_NOTIFY", reason: "EXPIRED" };
  }

  if (input.rules?.requireFirstVisit && input.context.firstVisit !== true) {
    return { status: "DO_NOT_NOTIFY", reason: "FIRST_VISIT_REQUIRED" };
  }

  if (input.rules?.requireAuthenticated && input.context.authenticated !== true) {
    return { status: "DO_NOT_NOTIFY", reason: "AUTHENTICATION_REQUIRED" };
  }

  if (input.context.alreadyDelivered === true) {
    return { status: "DO_NOT_NOTIFY", reason: "ALREADY_DELIVERED" };
  }

  const identity = audienceIdentity(input.audience)!;
  const notificationKey = input.notificationKey.trim();
  const plan: NotificationPlan = Object.freeze({
    notificationKey,
    audience: input.audience,
    trigger: input.trigger,
    content: Object.freeze({
      ...input.content,
      title: input.content.title.trim(),
      body: input.content.body.trim(),
    }),
    dedupeKey: input.dedupeKey?.trim() || `${notificationKey}:${identity}`,
    decidedAt: new Date(input.context.now),
  });

  return { status: "NOTIFY", value: plan };
}

export function createNotificationsDecisionCapability(): NotificationsDecisionCapability {
  return Object.freeze({
    decide: decideNotification,
  });
}
