CREATE TYPE "ReleaseLifecycle" AS ENUM ('DRAFT','INTERNAL','ALPHA','BETA','RELEASE_CANDIDATE','STABLE','LTS','DEPRECATED','ARCHIVED');
ALTER TABLE "ProductVersion" ADD COLUMN "lifecycle" "ReleaseLifecycle" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "ProductVersion" ADD COLUMN "backupEvidence" TEXT;
ALTER TABLE "ProductVersion" ADD COLUMN "complianceEvidence" TEXT;
CREATE TABLE "ReleaseApproval" (
 "id" TEXT NOT NULL, "versionId" TEXT NOT NULL, "stage" "ReleaseLifecycle" NOT NULL, "createdById" TEXT NOT NULL, "reviewedById" TEXT, "approvedById" TEXT, "approvedAt" TIMESTAMP(3), "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ReleaseApproval_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReleaseApproval_versionId_stage_idx" ON "ReleaseApproval"("versionId","stage");
ALTER TABLE "ReleaseApproval" ADD CONSTRAINT "ReleaseApproval_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProductVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseApproval" ADD CONSTRAINT "ReleaseApproval_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseApproval" ADD CONSTRAINT "ReleaseApproval_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReleaseApproval" ADD CONSTRAINT "ReleaseApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
