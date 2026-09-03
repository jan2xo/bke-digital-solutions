export const NOTIFICATIONS_DECISION_CAPABILITY_ID =
  "bke.notifications.decision.v1" as const;

export type NotificationAudience =
  | { readonly kind: "USER"; readonly userId: string }
  | { readonly kind: "ACCOUNT"; readonly accountId: string }
  | { readonly kind: "SEGMENT"; readonly segmentId: string }
  | { readonly kind: "ALL_USERS" }
  | { readonly kind: "ALL_ACTIVE_CLIENTS" }
  | { readonly kind: "VISITOR"; readonly visitorId?: string | null };

export type NotificationTrigger =
  | { readonly kind: "LOGIN" }
  | { readonly kind: "SITE_ENTRY" }
  | { readonly kind: "MANUAL" }
  | { readonly kind: "EVENT"; readonly eventName: string };

export type NotificationCategory =
  | "PROMOTION"
  | "ANNOUNCEMENT"
  | "TRANSACTIONAL"
  | "SYSTEM";

export interface NotificationContent {
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly actionLabel?: string | null;
  readonly actionTarget?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NotificationRules {
  readonly requireFirstVisit?: boolean;
  readonly requireAuthenticated?: boolean;
  readonly expiresAt?: Date | null;
}

export interface NotificationDecisionContext {
  readonly now: Date;
  readonly firstVisit?: boolean;
  readonly authenticated?: boolean;
  readonly alreadyDelivered?: boolean;
}

export interface DecideNotificationInput {
  readonly notificationKey: string;
  readonly audience: NotificationAudience;
  readonly trigger: NotificationTrigger;
  readonly content: NotificationContent;
  readonly rules?: NotificationRules;
  readonly context: NotificationDecisionContext;
  readonly dedupeKey?: string | null;
}

export interface NotificationPlan {
  readonly notificationKey: string;
  readonly audience: NotificationAudience;
  readonly trigger: NotificationTrigger;
  readonly content: NotificationContent;
  readonly dedupeKey: string;
  readonly decidedAt: Date;
}

export type NotificationDoNotNotifyReason =
  | "INVALID_INPUT"
  | "EXPIRED"
  | "FIRST_VISIT_REQUIRED"
  | "AUTHENTICATION_REQUIRED"
  | "ALREADY_DELIVERED";

export type DecideNotificationResult =
  | { readonly status: "NOTIFY"; readonly value: NotificationPlan }
  | { readonly status: "DO_NOT_NOTIFY"; readonly reason: NotificationDoNotNotifyReason };

export interface NotificationsDecisionCapability {
  decide(input: DecideNotificationInput): DecideNotificationResult;
}
