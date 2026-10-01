-- Native Agent-session recent-authentication timestamp.
-- Used only to gate sensitive plaintext secret reveal; no credential or MFA proof material is persisted.

ALTER TABLE "AgentAccountSession"
  ADD COLUMN "recentAuthenticatedAt" TIMESTAMP(3);

CREATE INDEX "AgentAccountSession_recentAuthenticatedAt_idx"
  ON "AgentAccountSession"("recentAuthenticatedAt");
