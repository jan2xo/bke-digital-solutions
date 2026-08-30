import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityLoginMfaProofProvider } from "../login-mfa-proof-provider";

const normalizeRecoveryCode = (code: string) =>
  code.replace(/[^A-Z2-7]/gi, "").toUpperCase();

const normalizeEmailOtp = (code: string) => code.trim().replace(/\s/g, "");

export function createHmacLoginMfaProofProvider(
  sessionSecret: string,
  mfaEncryptionKey?: string,
): IdentityLoginMfaProofProvider {
  if (!sessionSecret) {
    throw new Error("Identity session secret is required.");
  }

  const mfaKey = createHash("sha256")
    .update(mfaEncryptionKey || sessionSecret)
    .digest();

  const hashEmailOtp = (code: string) =>
    createHmac("sha256", mfaKey)
      .update(`admin-email-otp-code:${normalizeEmailOtp(code)}`)
      .digest("hex");

  return Object.freeze({
    hashChallengeToken(token: string) {
      return createHmac("sha256", sessionSecret).update(token).digest("hex");
    },

    verifyEmailCode(codeHash: string, candidate: string) {
      const normalized = normalizeEmailOtp(candidate);
      if (!/^\d{6}$/.test(normalized) || !/^[a-f0-9]{64}$/.test(codeHash)) {
        return false;
      }
      return timingSafeEqual(
        Buffer.from(codeHash, "hex"),
        Buffer.from(hashEmailOtp(normalized), "hex"),
      );
    },

    hashRecoveryCode(candidate: string) {
      return createHmac("sha256", mfaKey)
        .update(normalizeRecoveryCode(candidate))
        .digest("hex");
    },
  });
}
