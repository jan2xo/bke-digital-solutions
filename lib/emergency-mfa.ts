import { timingSafeEqual } from "node:crypto";
import { parseEnvironment } from "@/lib/config/environment";
import { createHmac, randomBytes } from "node:crypto";
const tokenHash = (token: string) => createHmac("sha256", parseEnvironment(process.env).SESSION_SECRET).update(token).digest("hex");
const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const EMERGENCY_ENROLLMENT_TTL_MS = 15 * 60_000;
export function verifyOwnerRecoverySecret(candidate: string) {
  const configured = parseEnvironment(process.env).ADMIN_OWNER_RECOVERY_KEY;
  if (!configured) return false;
  const expected = Buffer.from(configured);
  const supplied = Buffer.from(candidate);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
export function createEmergencyEnrollmentToken() {
  const token = randomToken();
  return { token, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + EMERGENCY_ENROLLMENT_TTL_MS) };
}
export { tokenHash };
