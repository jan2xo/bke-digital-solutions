CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentPublishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "markdownContent" TEXT NOT NULL,
    "renderedHtml" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "authorId" TEXT,
    "changeSummary" TEXT NOT NULL,
    "requiresReacceptance" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "documentVersionId" TEXT NOT NULL,
    "acceptanceContext" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "renderedContentHash" TEXT NOT NULL,
    "variablesSnapshot" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalDocument_slug_key" ON "LegalDocument"("slug");
CREATE UNIQUE INDEX "LegalDocument_currentPublishedVersionId_key" ON "LegalDocument"("currentPublishedVersionId");
CREATE INDEX "LegalDocument_documentType_status_idx" ON "LegalDocument"("documentType", "status");
CREATE UNIQUE INDEX "LegalDocumentVersion_documentId_versionNumber_key" ON "LegalDocumentVersion"("documentId", "versionNumber");
CREATE INDEX "LegalDocumentVersion_documentId_status_publishedAt_idx" ON "LegalDocumentVersion"("documentId", "status", "publishedAt");
CREATE UNIQUE INDEX "LegalAcceptance_userId_customerAccountId_documentVersionId_acceptanceContext_key" ON "LegalAcceptance"("userId", "customerAccountId", "documentVersionId", "acceptanceContext");
CREATE UNIQUE INDEX "LegalAcceptance_user_version_context_null_account_key" ON "LegalAcceptance"("userId", "documentVersionId", "acceptanceContext") WHERE "customerAccountId" IS NULL;
CREATE INDEX "LegalAcceptance_userId_acceptedAt_idx" ON "LegalAcceptance"("userId", "acceptedAt");
CREATE INDEX "LegalAcceptance_customerAccountId_acceptedAt_idx" ON "LegalAcceptance"("customerAccountId", "acceptedAt");
CREATE INDEX "LegalAcceptance_documentVersionId_acceptedAt_idx" ON "LegalAcceptance"("documentVersionId", "acceptedAt");

ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalDocumentVersion" ADD CONSTRAINT "LegalDocumentVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_currentPublishedVersionId_fkey" FOREIGN KEY ("currentPublishedVersionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "LegalDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "bke_protect_legal_acceptance"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LegalAcceptance records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegalAcceptance_immutable_update" BEFORE UPDATE ON "LegalAcceptance" FOR EACH ROW EXECUTE FUNCTION "bke_protect_legal_acceptance"();
CREATE TRIGGER "LegalAcceptance_immutable_delete" BEFORE DELETE ON "LegalAcceptance" FOR EACH ROW EXECUTE FUNCTION "bke_protect_legal_acceptance"();

CREATE FUNCTION "bke_protect_published_legal_version"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('PUBLISHED', 'ARCHIVED') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Published legal versions cannot be deleted';
    END IF;
    IF NEW."markdownContent" IS DISTINCT FROM OLD."markdownContent"
       OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
       OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
       OR NEW."documentId" IS DISTINCT FROM OLD."documentId"
       OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR NEW."authorId" IS DISTINCT FROM OLD."authorId" THEN
      RAISE EXCEPTION 'Published legal version content is immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LegalDocumentVersion_protect_update" BEFORE UPDATE ON "LegalDocumentVersion" FOR EACH ROW EXECUTE FUNCTION "bke_protect_published_legal_version"();
CREATE TRIGGER "LegalDocumentVersion_protect_delete" BEFORE DELETE ON "LegalDocumentVersion" FOR EACH ROW EXECUTE FUNCTION "bke_protect_published_legal_version"();
