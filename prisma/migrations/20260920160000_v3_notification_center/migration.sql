CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceModule" TEXT NOT NULL,
    "sourceEvent" TEXT NOT NULL,
    "sourceReference" TEXT,
    "audienceKind" TEXT NOT NULL,
    "audiencePrincipalId" TEXT,
    "audienceAccountId" TEXT,
    "audienceSegmentKey" TEXT,
    "audienceVisitorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "trigger" TEXT,
    "placementHint" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationReceipt" (
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'UNREAD',
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationReceipt_pkey" PRIMARY KEY ("notificationId","userId")
);

CREATE UNIQUE INDEX "NotificationMessage_idempotencyKey_key"
ON "NotificationMessage"("idempotencyKey");

CREATE INDEX "NotificationMessage_audienceKind_createdAt_idx"
ON "NotificationMessage"("audienceKind", "createdAt" DESC);

CREATE INDEX "NotificationMessage_audienceAccountId_createdAt_idx"
ON "NotificationMessage"("audienceAccountId", "createdAt" DESC);

CREATE INDEX "NotificationMessage_audiencePrincipalId_createdAt_idx"
ON "NotificationMessage"("audiencePrincipalId", "createdAt" DESC);

CREATE INDEX "NotificationMessage_productId_createdAt_idx"
ON "NotificationMessage"("productId", "createdAt" DESC);

CREATE INDEX "NotificationMessage_expiresAt_idx"
ON "NotificationMessage"("expiresAt");

CREATE INDEX "NotificationReceipt_userId_state_updatedAt_idx"
ON "NotificationReceipt"("userId", "state", "updatedAt" DESC);

ALTER TABLE "NotificationReceipt"
ADD CONSTRAINT "NotificationReceipt_notificationId_fkey"
FOREIGN KEY ("notificationId")
REFERENCES "NotificationMessage"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "NotificationReceipt"
ADD CONSTRAINT "NotificationReceipt_userId_fkey"
FOREIGN KEY ("userId")
REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
