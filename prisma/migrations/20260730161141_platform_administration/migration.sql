-- CreateEnum
CREATE TYPE "ReleaseChannel" AS ENUM ('STABLE', 'BETA');

-- AlterTable
ALTER TABLE "DeviceActivation" ADD COLUMN     "architecture" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "machineIdHint" TEXT,
ADD COLUMN     "operatingSystem" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'General',
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "licenseType" TEXT NOT NULL DEFAULT 'Commercial',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ProductArtifact" ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "removedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductVersion" ADD COLUMN     "changelog" TEXT,
ADD COLUMN     "channel" "ReleaseChannel" NOT NULL DEFAULT 'STABLE',
ADD COLUMN     "deprecatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3);
