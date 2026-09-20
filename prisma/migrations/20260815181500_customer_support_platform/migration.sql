-- Customer support platform: private, auditable, account-scoped tickets.
CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCOUNT','PAYMENT','REFUND','INVOICE','LICENSE','DEVICE','DOWNLOAD','SECURITY','FEATURE_REQUEST','OTHER');
CREATE TYPE "SupportTicketState" AS ENUM ('OPEN','TRIAGED','WAITING_ON_CUSTOMER','WAITING_ON_SUPPORT','ESCALATED','RESOLVED','CLOSED');
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW','NORMAL','HIGH','URGENT');
CREATE TYPE "SupportMessageVisibility" AS ENUM ('PUBLIC','INTERNAL');

CREATE TABLE "SupportTicket" (
  "id" TEXT NOT NULL,
  "publicId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "orderId" TEXT,
  "licenseId" TEXT,
  "category" "SupportTicketCategory" NOT NULL,
  "state" "SupportTicketState" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "subject" TEXT NOT NULL,
  "safeContext" JSONB NOT NULL DEFAULT '{}',
  "securityReport" BOOLEAN NOT NULL DEFAULT false,
  "assignedToId" TEXT,
  "escalatedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "lastCustomerReplyAt" TIMESTAMP(3),
  "lastAdminReplyAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketMessage" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "visibility" "SupportMessageVisibility" NOT NULL DEFAULT 'PUBLIC',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketEvent" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportTicket_publicId_key" ON "SupportTicket"("publicId");
CREATE INDEX "SupportTicket_createdById_createdAt_idx" ON "SupportTicket"("createdById", "createdAt");
CREATE INDEX "SupportTicket_accountId_createdAt_idx" ON "SupportTicket"("accountId", "createdAt");
CREATE INDEX "SupportTicket_state_priority_createdAt_idx" ON "SupportTicket"("state", "priority", "createdAt");
CREATE INDEX "SupportTicket_assignedToId_state_idx" ON "SupportTicket"("assignedToId", "state");
CREATE INDEX "SupportTicket_securityReport_state_idx" ON "SupportTicket"("securityReport", "state");
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");
CREATE INDEX "SupportTicketMessage_authorId_createdAt_idx" ON "SupportTicketMessage"("authorId", "createdAt");
CREATE INDEX "SupportTicketEvent_ticketId_createdAt_idx" ON "SupportTicketEvent"("ticketId", "createdAt");
CREATE INDEX "SupportTicketEvent_actorId_createdAt_idx" ON "SupportTicketEvent"("actorId", "createdAt");
CREATE INDEX "SupportTicketEvent_eventType_createdAt_idx" ON "SupportTicketEvent"("eventType", "createdAt");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
