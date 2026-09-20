-- AlterTable
ALTER TABLE "License" ADD COLUMN     "keyCiphertext" TEXT,
ADD COLUMN     "keyRevealedAt" TIMESTAMP(3);
