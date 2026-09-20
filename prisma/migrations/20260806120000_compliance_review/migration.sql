CREATE TABLE "ComplianceRequirement" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IMPLEMENTED',
  "owner" TEXT,
  "reviewer" TEXT,
  "description" TEXT NOT NULL,
  "decision" TEXT,
  "dueAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ComplianceRequirement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ComplianceEvidence" (
  "id" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "reference" TEXT,
  "recordedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplianceEvidence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ComplianceRequirement_key_key" ON "ComplianceRequirement"("key");
CREATE INDEX "ComplianceRequirement_category_status_idx" ON "ComplianceRequirement"("category", "status");
CREATE INDEX "ComplianceRequirement_status_dueAt_idx" ON "ComplianceRequirement"("status", "dueAt");
CREATE INDEX "ComplianceEvidence_requirementId_createdAt_idx" ON "ComplianceEvidence"("requirementId", "createdAt");
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "ComplianceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ComplianceEvidence" ADD CONSTRAINT "ComplianceEvidence_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
