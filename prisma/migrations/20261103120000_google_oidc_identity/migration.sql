ALTER TYPE "SessionAuthenticationMethod" ADD VALUE IF NOT EXISTS 'GOOGLE_OIDC';
ALTER TYPE "SessionAuthenticationMethod" ADD VALUE IF NOT EXISTS 'GOOGLE_OIDC_EMAIL_OTP';
ALTER TYPE "SessionAuthenticationMethod" ADD VALUE IF NOT EXISTS 'GOOGLE_OIDC_RECOVERY';

DO $$ BEGIN
  CREATE TYPE "MfaChallengeAuthenticationMethod" AS ENUM ('PASSWORD', 'GOOGLE_OIDC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "MfaChallenge"
  ADD COLUMN IF NOT EXISTS "primaryAuthenticationMethod" "MfaChallengeAuthenticationMethod" NOT NULL DEFAULT 'PASSWORD';
ALTER TABLE "MfaChallenge"
  ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

CREATE TABLE IF NOT EXISTS "GoogleIdentity" (
  "userId" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleIdentity_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleIdentity_subject_key" ON "GoogleIdentity"("subject");
CREATE INDEX IF NOT EXISTS "MfaChallenge_sessionId_idx" ON "MfaChallenge"("sessionId");

DO $$ BEGIN
  ALTER TABLE "GoogleIdentity"
    ADD CONSTRAINT "GoogleIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "MfaChallenge"
    ADD CONSTRAINT "MfaChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
