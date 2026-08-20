CREATE TABLE "PrivacyRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "responseSummary" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivacyRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrivacyRequest_userId_createdAt_idx" ON "PrivacyRequest"("userId", "createdAt");
CREATE INDEX "PrivacyRequest_customerAccountId_createdAt_idx" ON "PrivacyRequest"("customerAccountId", "createdAt");
CREATE INDEX "PrivacyRequest_status_createdAt_idx" ON "PrivacyRequest"("status", "createdAt");
CREATE INDEX "PrivacyRequest_requestType_status_idx" ON "PrivacyRequest"("requestType", "status");

ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequest" ADD CONSTRAINT "PrivacyRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
