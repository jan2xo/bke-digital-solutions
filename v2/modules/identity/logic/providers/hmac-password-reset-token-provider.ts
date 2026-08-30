import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { IdentityPasswordResetTokenProvider } from "../password-reset-token-provider";

export function createHmacPasswordResetTokenProvider(
  sessionSecret: string,
): IdentityPasswordResetTokenProvider {
  if (!sessionSecret) {
    throw new Error("Identity session secret is required.");
  }

  return Object.freeze({
    issue() {
      const token = randomBytes(32).toString("base64url");
      return {
        tokenId: randomUUID(),
        token,
        tokenHash: createHmac("sha256", sessionSecret)
          .update(token)
          .digest("hex"),
      };
    },
  });
}
