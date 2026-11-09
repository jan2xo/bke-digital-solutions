import "server-only";

import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { consumeOneTimeKey } from "@/apps/web/http/rate-limit";
import { authoritativeGoogleContact } from "@/apps/web/auth/google-policy";
import { safeLocalRedirect } from "@/apps/web/security/redirect";

const TTL_SECONDS = 600;
const ISSUER = "bke-digital-solutions";
const AUDIENCE = "google-customer-enrollment";

export const GOOGLE_ENROLLMENT_COOKIE = process.env.NODE_ENV === "production"
  ? "__Host-bke_google_enrollment"
  : "bke_google_enrollment";
export const GOOGLE_ENROLLMENT_TTL_SECONDS = TTL_SECONDS;

const pendingSchema = z.object({
  subject: z.string().min(1).max(255),
  email: z.string().email().max(320),
  emailVerified: z.literal(true),
  hostedDomain: z.string().max(255).nullable(),
  name: z.string().max(100).nullable(),
  authenticatedAt: z.number().int().nonnegative().nullable(),
  returnTo: z.string(),
  jti: z.string().uuid(),
});

async function enrollmentKey(): Promise<Uint8Array> {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) throw new Error("GOOGLE_ENROLLMENT_UNAVAILABLE");
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`bke-google-enrollment:v1:${secret}`),
  ));
}

/** Only call after completeGoogleAuthorization validates signed Google OIDC claims. */
export async function createPendingGoogleEnrollment(input: {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly hostedDomain: string | null;
  readonly name: string | null;
  readonly authenticatedAt: Date | null;
  readonly returnTo: string;
}): Promise<string> {
  if (!authoritativeGoogleContact(input) || !input.email) {
    throw new Error("CONTACT_EMAIL_NOT_AUTHORITATIVE");
  }
  const verified = pendingSchema.parse({
    subject: input.subject,
    email: input.email,
    emailVerified: input.emailVerified,
    hostedDomain: input.hostedDomain,
    name: input.name,
    authenticatedAt: input.authenticatedAt?.getTime() ?? null,
    returnTo: safeLocalRedirect(input.returnTo),
    jti: crypto.randomUUID(),
  });
  return new EncryptJWT(verified)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .encrypt(await enrollmentKey());
}

export async function readPendingGoogleEnrollment(encrypted: string) {
  const { payload } = await jwtDecrypt(encrypted, await enrollmentKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    maxTokenAge: TTL_SECONDS,
  });
  const parsed = pendingSchema.parse(payload);
  if (!authoritativeGoogleContact(parsed)) throw new Error("INVALID_GOOGLE_ENROLLMENT");
  if (parsed.authenticatedAt !== null && parsed.authenticatedAt > Date.now()) {
    throw new Error("INVALID_GOOGLE_ENROLLMENT");
  }
  return {
    ...parsed,
    returnTo: safeLocalRedirect(parsed.returnTo),
    authenticatedAt: parsed.authenticatedAt === null ? null : new Date(parsed.authenticatedAt),
  };
}

export async function consumePendingGoogleEnrollment(jti: string): Promise<boolean> {
  return consumeOneTimeKey(`google-customer-enrollment:${jti}`, TTL_SECONDS);
}
