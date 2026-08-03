ALTER TYPE "MfaChallengePurpose" ADD VALUE IF NOT EXISTS 'ENROLLMENT';
ALTER TYPE "MfaChallengePurpose" ADD VALUE IF NOT EXISTS 'RECENT_AUTH';
ALTER TYPE "SessionAuthenticationMethod" ADD VALUE IF NOT EXISTS 'PASSWORD_EMAIL_OTP';

ALTER TABLE "AdministratorMfaMethod" ALTER COLUMN "encryptedSecret" DROP NOT NULL;
UPDATE "AdministratorMfaMethod" SET "encryptedSecret" = NULL;
