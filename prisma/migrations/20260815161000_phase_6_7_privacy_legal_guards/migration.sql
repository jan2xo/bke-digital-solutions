-- Phase 6.7 repository-controlled privacy and legal data guarantees.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "PrivacyRequest"
  ADD CONSTRAINT "PrivacyRequest_requestType_valid" CHECK ("requestType" IN ('ACCESS', 'CORRECTION', 'EXPORT', 'DELETION', 'RESTRICTION', 'OBJECTION', 'BREACH_REPORT')),
  ADD CONSTRAINT "PrivacyRequest_status_valid" CHECK ("status" IN ('OPEN', 'IN_REVIEW', 'FULFILLED', 'REJECTED', 'CANCELLED'));

CREATE TABLE "PrivacyRequestEvent" (
    "id" TEXT NOT NULL,
    "privacyRequestId" TEXT NOT NULL,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyRequestEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PrivacyRequestEvent_eventType_valid" CHECK ("eventType" IN ('CREATED', 'STATUS_CHANGED')),
    CONSTRAINT "PrivacyRequestEvent_toStatus_valid" CHECK ("toStatus" IS NULL OR "toStatus" IN ('OPEN', 'IN_REVIEW', 'FULFILLED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "PrivacyRequestEvent_fromStatus_valid" CHECK ("fromStatus" IS NULL OR "fromStatus" IN ('OPEN', 'IN_REVIEW', 'FULFILLED', 'REJECTED', 'CANCELLED'))
);

CREATE INDEX "PrivacyRequestEvent_privacyRequestId_createdAt_idx" ON "PrivacyRequestEvent"("privacyRequestId", "createdAt");
CREATE INDEX "PrivacyRequestEvent_actorId_createdAt_idx" ON "PrivacyRequestEvent"("actorId", "createdAt");
ALTER TABLE "PrivacyRequestEvent" ADD CONSTRAINT "PrivacyRequestEvent_privacyRequestId_fkey" FOREIGN KEY ("privacyRequestId") REFERENCES "PrivacyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivacyRequestEvent" ADD CONSTRAINT "PrivacyRequestEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "PrivacyRequestEvent" ("id", "privacyRequestId", "actorId", "eventType", "toStatus", "metadata", "createdAt")
SELECT 'pre_' || "id", "id", "userId", 'CREATED', "status", jsonb_build_object('backfill', true, 'requestType', "requestType"), "createdAt"
FROM "PrivacyRequest"
ON CONFLICT DO NOTHING;

CREATE FUNCTION "bke_protect_privacy_request_event"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PrivacyRequestEvent records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PrivacyRequestEvent_immutable_update" BEFORE UPDATE ON "PrivacyRequestEvent" FOR EACH ROW EXECUTE FUNCTION "bke_protect_privacy_request_event"();
CREATE TRIGGER "PrivacyRequestEvent_immutable_delete" BEFORE DELETE ON "PrivacyRequestEvent" FOR EACH ROW EXECUTE FUNCTION "bke_protect_privacy_request_event"();

-- Compatibility guard for early environments that may have nullable or blank hashes from pre-release migrations.
UPDATE "LegalDocumentVersion"
SET "contentHash" = encode(sha256(convert_to(COALESCE("renderedHtml", "markdownContent", ''), 'UTF8')), 'hex')
WHERE "contentHash" IS NULL OR "contentHash" = '';

ALTER TABLE "LegalDocumentVersion"
  ALTER COLUMN "contentHash" SET NOT NULL,
  ADD CONSTRAINT "LegalDocumentVersion_contentHash_sha256_hex" CHECK ("contentHash" ~ '^[a-f0-9]{64}$');
