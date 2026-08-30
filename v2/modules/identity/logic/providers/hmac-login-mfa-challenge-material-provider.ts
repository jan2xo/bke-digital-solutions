import type { IdentityLoginMfaChallengeMaterialProvider } from "../login-mfa-challenge-material-provider";
import { createHmacEmailMfaChallengeMaterialProvider } from "./hmac-email-mfa-challenge-material-provider";

export function createHmacLoginMfaChallengeMaterialProvider(
  sessionSecret: string,
  mfaEncryptionKey?: string,
): IdentityLoginMfaChallengeMaterialProvider {
  return createHmacEmailMfaChallengeMaterialProvider(
    sessionSecret,
    mfaEncryptionKey,
  );
}
