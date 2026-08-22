CREATE TYPE "ArtifactUploadState" AS ENUM ('PENDING', 'UPLOADED', 'VERIFYING', 'VERIFIED', 'FAILED', 'EXPIRED');

CREATE TABLE "ArtifactUploadSession" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "expectedSize" BIGINT NOT NULL,
    "expectedSha256" TEXT,
    "state" "ArtifactUploadState" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArtifactUploadSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtifactUploadSession_objectKey_key" ON "ArtifactUploadSession"("objectKey");
CREATE INDEX "ArtifactUploadSession_versionId_state_idx" ON "ArtifactUploadSession"("versionId", "state");
CREATE INDEX "ArtifactUploadSession_expiresAt_state_idx" ON "ArtifactUploadSession"("expiresAt", "state");
ALTER TABLE "ArtifactUploadSession" ADD CONSTRAINT "ArtifactUploadSession_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactUploadSession" ADD CONSTRAINT "ArtifactUploadSession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProductVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtifactUploadSession" ADD CONSTRAINT "ArtifactUploadSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
