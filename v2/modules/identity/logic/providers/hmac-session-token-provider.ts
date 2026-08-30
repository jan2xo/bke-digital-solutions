import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { IdentitySessionTokenProvider } from "../session-token-provider";

export function createHmacSessionTokenProvider(
  sessionSecret: string,
): IdentitySessionTokenProvider {
  if (!sessionSecret) {
    throw new Error("Identity session secret is required.");
  }

  return Object.freeze({
    issue() {
      const token = randomBytes(32).toString("base64url");
      return {
        sessionId: randomUUID(),
        token,
        tokenHash: createHmac("sha256", sessionSecret).update(token).digest("hex"),
      };
    },
  });
}
