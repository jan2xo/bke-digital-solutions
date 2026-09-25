import "server-only";

import { createHash } from "node:crypto";
import {
  NOTIFICATIONS_INBOX_POLICY_CAPABILITY_ID,
  type NotificationsDurableSnapshot,
  type NotificationsInboxPolicyCapability,
  type NotificationsPrincipalContext,
  type NotificationsReceiptState,
} from "@bke/notifications/contracts/notification-inbox.contract";
import {
  NOTIFICATIONS_INTENT_CAPABILITY_ID,
  type NotificationsAudience,
  type NotificationsCreateIntentInput,
  type NotificationsIntentCapability,
} from "@bke/notifications/contracts/notification-intent.contract";
import { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";

export type PersistNotificationInput = NotificationsCreateIntentInput & Readonly<{
  createdAt?: Date;
  productId?: string | null;
}>;

export type WebNotificationItem = Readonly<{
  id: string;
  source: string;
  event: string;
  title: string;
  body: string;
  category: string;
  priority: string;
  createdAt: Date;
  expiresAt: Date | null;
  state: NotificationsReceiptState;
  audienceKind: NotificationsAudience["kind"];
  accountId: string | null;
  accountName: string | null;
  productId: string | null;
  data: unknown;
}>;

type NotificationRow = Awaited<ReturnType<typeof db.notificationMessage.findFirst>>;

function notificationId(idempotencyKey: string): string {
  const hash = createHash("sha256")
    .update("bke-notification-message-v1\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");
  return `bke-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function capabilities() {
  const application = await getV2WebApplication();
  return {
    intent: application.get<NotificationsIntentCapability>(
      NOTIFICATIONS_INTENT_CAPABILITY_ID,
    ),
    inbox: application.get<NotificationsInboxPolicyCapability>(
      NOTIFICATIONS_INBOX_POLICY_CAPABILITY_ID,
    ),
  };
}

function audienceColumns(audience: NotificationsAudience) {
  return {
    audienceKind: audience.kind,
    audiencePrincipalId: audience.kind === "PRINCIPAL" ? audience.principalId : null,
    audienceAccountId: audience.kind === "ACCOUNT" ? audience.accountId : null,
    audienceSegmentKey: audience.kind === "SEGMENT" ? audience.segmentKey : null,
    audienceVisitorId: audience.kind === "VISITOR" ? audience.visitorId ?? null : null,
  };
}

function rowAudience(row: {
  audienceKind: string;
  audiencePrincipalId: string | null;
  audienceAccountId: string | null;
  audienceSegmentKey: string | null;
  audienceVisitorId: string | null;
}): NotificationsAudience {
  switch (row.audienceKind) {
    case "PRINCIPAL":
      if (!row.audiencePrincipalId) throw new Error("NOTIFICATION_AUDIENCE_CORRUPT");
      return { kind: "PRINCIPAL", principalId: row.audiencePrincipalId };
    case "ACCOUNT":
      if (!row.audienceAccountId) throw new Error("NOTIFICATION_AUDIENCE_CORRUPT");
      return { kind: "ACCOUNT", accountId: row.audienceAccountId };
    case "ADMINISTRATORS":
      return { kind: "ADMINISTRATORS" };
    case "SEGMENT":
      if (!row.audienceSegmentKey) throw new Error("NOTIFICATION_AUDIENCE_CORRUPT");
      return { kind: "SEGMENT", segmentKey: row.audienceSegmentKey };
    case "ALL_USERS":
      return { kind: "ALL_USERS" };
    case "ALL_ACTIVE_CLIENTS":
      return { kind: "ALL_ACTIVE_CLIENTS" };
    case "VISITOR":
      return { kind: "VISITOR", visitorId: row.audienceVisitorId };
    default:
      throw new Error("NOTIFICATION_AUDIENCE_CORRUPT");
  }
}

function rowSnapshot(row: NonNullable<NotificationRow>): NotificationsDurableSnapshot {
  return Object.freeze({
    notificationId: row.id,
    source: Object.freeze({
      moduleId: row.sourceModule,
      event: row.sourceEvent,
      sourceReference: row.sourceReference,
    }),
    audience: Object.freeze(rowAudience(row)),
    content: Object.freeze({
      title: row.title,
      body: row.body,
      category: row.category as NotificationsDurableSnapshot["content"]["category"],
      data: row.data,
    }),
    context: Object.freeze({
      trigger: row.trigger as NotificationsDurableSnapshot["context"]["trigger"],
      placementHint: row.placementHint,
      attributes: Object.freeze(
        (row.attributes && typeof row.attributes === "object" && !Array.isArray(row.attributes))
          ? { ...(row.attributes as Record<string, unknown>) }
          : {},
      ),
    }),
    priority: row.priority as NotificationsDurableSnapshot["priority"],
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  });
}

export async function persistNotification(
  tx: Prisma.TransactionClient,
  input: PersistNotificationInput,
) {
  const { createdAt = new Date(), productId = null, ...intentInput } = input;
  const { intent, inbox } = await capabilities();
  const decision = intent.create(intentInput);
  if (decision.status !== "NOTIFY") return decision;

  const materialized = inbox.materialize({
    notificationId: notificationId(decision.value.idempotencyKey),
    intent: decision.value,
    createdAt,
  });
  if (materialized.status !== "MATERIALIZED") {
    throw new Error(`NOTIFICATION_MATERIALIZATION_${materialized.code}`);
  }

  const snapshot = materialized.value;
  const audience = audienceColumns(snapshot.audience);
  const existing = await tx.notificationMessage.findUnique({
    where: { idempotencyKey: snapshot.idempotencyKey },
  });
  if (existing) return { status: "EXISTS" as const, notification: existing };

  const notification = await tx.notificationMessage.create({
    data: {
      id: snapshot.notificationId,
      idempotencyKey: snapshot.idempotencyKey,
      sourceModule: snapshot.source.moduleId,
      sourceEvent: snapshot.source.event,
      sourceReference: snapshot.source.sourceReference,
      ...audience,
      title: snapshot.content.title,
      body: snapshot.content.body,
      category: snapshot.content.category,
      priority: snapshot.priority,
      trigger: snapshot.context.trigger,
      placementHint: snapshot.context.placementHint,
      attributes: snapshot.context.attributes as Prisma.InputJsonValue,
      ...(snapshot.content.data == null
        ? {}
        : { data: snapshot.content.data as Prisma.InputJsonValue }),
      productId,
      createdAt: snapshot.createdAt,
      expiresAt: snapshot.expiresAt,
    },
  });
  return { status: "CREATED" as const, notification };
}

export async function persistNotificationOutsideTransaction(
  input: PersistNotificationInput,
) {
  return db.$transaction(
    (tx) => persistNotification(tx, input),
    { isolationLevel: "Serializable" },
  );
}

async function principalContext(userId: string, role: string): Promise<NotificationsPrincipalContext> {
  const accounts = await db.customerAccount.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { memberships: { some: { userId } } },
      ],
    },
    select: { id: true },
  });
  return Object.freeze({
    principalId: userId,
    role,
    accountIds: Object.freeze(accounts.map((account) => account.id)),
    segmentKeys: Object.freeze([]),
    activeClient: false,
    visitorId: null,
  });
}

function candidateWhere(
  principal: NotificationsPrincipalContext,
): Prisma.NotificationMessageWhereInput {
  const audience: Prisma.NotificationMessageWhereInput[] = [
    {
      audienceKind: "PRINCIPAL",
      audiencePrincipalId: principal.principalId,
    },
    { audienceKind: "ALL_USERS" },
  ];
  if (principal.accountIds.length) {
    audience.push({
      audienceKind: "ACCOUNT",
      audienceAccountId: { in: [...principal.accountIds] },
    });
  }
  if (principal.role === "ADMIN") {
    audience.push({ audienceKind: "ADMINISTRATORS" });
  }
  if (principal.activeClient) {
    audience.push({ audienceKind: "ALL_ACTIVE_CLIENTS" });
  }
  if (principal.segmentKeys?.length) {
    audience.push({
      audienceKind: "SEGMENT",
      audienceSegmentKey: { in: [...principal.segmentKeys] },
    });
  }
  return { OR: audience };
}

async function listNotificationsForPrincipal(
  principal: NotificationsPrincipalContext,
  input: Readonly<{
    limit?: number;
    includeDismissed?: boolean;
  }>,
): Promise<readonly WebNotificationItem[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const { inbox } = await capabilities();
  const rows = await db.notificationMessage.findMany({
    where: candidateWhere(principal),
    include: {
      receipts: {
        where: { userId: principal.principalId },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit * 3, 600),
  });

  const accountIds = [...new Set(rows
    .map((row) => row.audienceAccountId)
    .filter((value): value is string => Boolean(value)))];
  const accounts = accountIds.length
    ? await db.customerAccount.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const accountNames = new Map(accounts.map((account) => [account.id, account.displayName]));

  const items: WebNotificationItem[] = [];
  for (const row of rows) {
    const state = (row.receipts[0]?.state ?? "UNREAD") as NotificationsReceiptState;
    const visibility = inbox.visibility({
      notification: rowSnapshot(row),
      principal,
      receiptState: state,
    });
    if (
      visibility.status !== "VISIBLE" &&
      !(input.includeDismissed && visibility.code === "DISMISSED")
    ) {
      continue;
    }
    items.push(Object.freeze({
      id: row.id,
      source: row.sourceModule,
      event: row.sourceEvent,
      title: row.title,
      body: row.body,
      category: row.category,
      priority: row.priority,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      state,
      audienceKind: rowAudience(row).kind,
      accountId: row.audienceAccountId,
      accountName: row.audienceAccountId
        ? accountNames.get(row.audienceAccountId) ?? null
        : null,
      productId: row.productId,
      data: row.data,
    }));
    if (items.length >= limit) break;
  }
  return Object.freeze(items);
}

export async function listNotificationsForUser(input: Readonly<{
  userId: string;
  role: string;
  limit?: number;
  includeDismissed?: boolean;
}>): Promise<readonly WebNotificationItem[]> {
  const principal = await principalContext(input.userId, input.role);
  return listNotificationsForPrincipal(principal, input);
}

export async function listNotificationsForAgentSession(input: Readonly<{
  userId: string;
  accountId: string;
  limit?: number;
}>): Promise<readonly WebNotificationItem[]> {
  const principal = Object.freeze({
    principalId: input.userId,
    role: "CUSTOMER",
    accountIds: Object.freeze([input.accountId]),
    segmentKeys: Object.freeze([]),
    activeClient: true,
    visitorId: null,
  } satisfies NotificationsPrincipalContext);

  return listNotificationsForPrincipal(principal, {
    limit: input.limit,
    includeDismissed: false,
  });
}

async function mutateReceipt(input: Readonly<{
  userId: string;
  role: string;
  notificationId: string;
  action: "MARK_READ" | "DISMISS";
}>) {
  const principal = await principalContext(input.userId, input.role);
  const row = await db.notificationMessage.findUnique({
    where: { id: input.notificationId },
    include: {
      receipts: {
        where: { userId: input.userId },
        take: 1,
      },
    },
  });
  if (!row) return { status: "NOT_FOUND" as const };

  const { inbox } = await capabilities();
  const current = (row.receipts[0]?.state ?? "UNREAD") as NotificationsReceiptState;
  const visibility = inbox.visibility({
    notification: rowSnapshot(row),
    principal,
    receiptState: current === "DISMISSED" ? null : current,
  });
  if (visibility.status !== "VISIBLE" && current !== "DISMISSED") {
    return { status: "NOT_FOUND" as const };
  }

  const transition = inbox.transitionReceipt({
    state: current,
    action: input.action,
  });
  if (transition.status === "FAILED") {
    throw new Error(`NOTIFICATION_RECEIPT_${transition.code}`);
  }
  if (transition.status === "UNCHANGED") {
    return { status: "UNCHANGED" as const, state: transition.state };
  }

  const now = new Date();
  await db.notificationReceipt.upsert({
    where: {
      notificationId_userId: {
        notificationId: row.id,
        userId: input.userId,
      },
    },
    create: {
      notificationId: row.id,
      userId: input.userId,
      state: transition.state,
      readAt: transition.state === "READ" ? now : null,
      dismissedAt: transition.state === "DISMISSED" ? now : null,
    },
    update: {
      state: transition.state,
      ...(transition.state === "READ" ? { readAt: now } : {}),
      ...(transition.state === "DISMISSED" ? { dismissedAt: now } : {}),
    },
  });
  return { status: "UPDATED" as const, state: transition.state };
}

export function markNotificationRead(input: Readonly<{
  userId: string;
  role: string;
  notificationId: string;
}>) {
  return mutateReceipt({ ...input, action: "MARK_READ" });
}

export function dismissNotification(input: Readonly<{
  userId: string;
  role: string;
  notificationId: string;
}>) {
  return mutateReceipt({ ...input, action: "DISMISS" });
}

export async function unreadNotificationCount(input: Readonly<{
  userId: string;
  role: string;
}>): Promise<number> {
  const items = await listNotificationsForUser({
    ...input,
    limit: 200,
  });
  return items.filter((item) => item.state === "UNREAD").length;
}

export async function listAccountProductNotifications(input: Readonly<{
  accountId: string;
  productId: string;
  limit?: number;
}>) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const rows = await db.notificationMessage.findMany({
    where: {
      audienceKind: "ACCOUNT",
      audienceAccountId: input.accountId,
      productId: input.productId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return Object.freeze(rows.map((row) => {
    const snapshot = rowSnapshot(row);
    return Object.freeze({
      id: snapshot.notificationId,
      source: snapshot.source.moduleId,
      event: snapshot.source.event,
      title: snapshot.content.title,
      body: snapshot.content.body,
      category: snapshot.content.category,
      priority: snapshot.priority,
      createdAt: snapshot.createdAt.toISOString(),
      expiresAt: snapshot.expiresAt?.toISOString() ?? null,
      data: snapshot.content.data,
    });
  }));
}
