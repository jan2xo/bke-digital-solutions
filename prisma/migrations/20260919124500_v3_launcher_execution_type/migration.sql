-- V3 Launcher execution policy.
-- This answers HOW a desktop product runs after entitlement, not whether it is
-- SOFTWARE/SAAS/HYBRID. NULL intentionally means the owner has not assigned
-- a Launcher execution policy yet.

CREATE TYPE "LauncherExecutionType" AS ENUM ('LAUNCHER_PLUGIN', 'STANDALONE');

ALTER TABLE "Product"
  ADD COLUMN "launcherExecutionType" "LauncherExecutionType";

CREATE INDEX "Product_launcherExecutionType_idx"
  ON "Product"("launcherExecutionType");
