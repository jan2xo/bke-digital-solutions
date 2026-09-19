import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import {
  normalizeGoogleOidcReturnTo,
  type VerifiedGoogleOidcIdentity,
} from "./google-oidc";

const INTENT_ISSUER = "bke-digital-solutions";
const INTENT_AUDIENCE = "bke-google-registration";
const INTENT_TYPE = "bke-google-registration-intent+jwt";
const INTENT_TTL_SECONDS = 15 * 60;
const MAX_ASSERTION_AGE_MS = 15 * 60 * 1000;
const MAX_ASSERTION_FUTURE_SKEW_MS = 60 * 1000;

export interface GoogleRegistrationIntent {
  readonly id: string;
  readonly provider: "GOOGLE";
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: true;
  readonly name: string | null;
  readonly authenticatedAt: Date;
  readonly returnTo: string;
  readonly expiresAt: Date;
}

function derivedIntentKey(secret: string): Uint8Array {
  const normalized = secret.trim();
  if (normalized.length < 32) {
    throw new Error("GOOGLE_OIDC_TRANSACTION_SECRET_REQUIRED");
  }
  return createHash("sha256")
    .update("bke-google-registration-intent-v1\0", "utf8")
    .update(normalized, "utf8")
    .digest();
}

function validateVerifiedIdentity(
  identity: VerifiedGoogleOidcIdentity,
  now: Date,
): void {
  if (
    identity.provider !== "GOOGLE" ||
    !identity.subject.trim() ||
    identity.subject.length > 255 ||
    !identity.email.trim() ||
    identity.email.length > 320 ||
    !identity.emailVerified ||
    !Number.isFinite(identity.authenticatedAt.getTime())
  ) {
    throw new Error("GOOGLE_REGISTRATION_IDENTITY_INVALID");
  }

  const age = now.getTime() - identity.authenticatedAt.getTime();
  if (age > MAX_ASSERTION_AGE_MS || age < -MAX_ASSERTION_FUTURE_SKEW_MS) {
    throw new Error("GOOGLE_REGISTRATION_ASSERTION_STALE");
  }
}

export async function createGoogleRegistrationIntent(input: Readonly<{
  identity: VerifiedGoogleOidcIdentity;
  transactionSecret: string;
  returnTo?: string | null;
}>): Promise<{
  readonly token: string;
  readonly intent: GoogleRegistrationIntent;
}> {
  const now = new Date();
  validateVerifiedIdentity(input.identity, now);

  const id = randomBytes(24).toString("base64url");
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + INTENT_TTL_SECONDS) * 1000);
  const returnTo = normalizeGoogleOidcReturnTo(input.returnTo);
  const subject = input.identity.subject.trim();
  const email = input.identity.email.trim().toLowerCase();
  const name = input.identity.name?.trim() || null;

  const token = await new EncryptJWT({
    provider: "GOOGLE",
    subject,
    email,
    emailVerified: true,
    name,
    authenticatedAt: input.identity.authenticatedAt.toISOString(),
    returnTo,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: INTENT_TYPE })
    .setIssuer(INTENT_ISSUER)
    .setAudience(INTENT_AUDIENCE)
    .setJti(id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + INTENT_TTL_SECONDS)
    .encrypt(derivedIntentKey(input.transactionSecret));

  return Object.freeze({
    token,
    intent: Object.freeze({
      id,
      provider: "GOOGLE" as const,
      subject,
      email,
      emailVerified: true as const,
      name,
      authenticatedAt: new Date(input.identity.authenticatedAt),
      returnTo,
      expiresAt,
    }),
  });
}

export async function readGoogleRegistrationIntent(
  token: string,
  transactionSecret: string,
): Promise<GoogleRegistrationIntent> {
  if (!token.trim()) throw new Error("GOOGLE_REGISTRATION_INTENT_MISSING");

  const { payload, protectedHeader } = await jwtDecrypt(
    token,
    derivedIntentKey(transactionSecret),
    {
      issuer: INTENT_ISSUER,
      audience: INTENT_AUDIENCE,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    },
  );

  if (protectedHeader.typ !== INTENT_TYPE) {
    throw new Error("GOOGLE_REGISTRATION_INTENT_INVALID");
  }

  const id = typeof payload.jti === "string" ? payload.jti : "";
  const provider = payload.provider;
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const emailVerified = payload.emailVerified;
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null;
  const authenticatedAtText =
    typeof payload.authenticatedAt === "string" ? payload.authenticatedAt : "";
  const returnTo =
    typeof payload.returnTo === "string"
      ? normalizeGoogleOidcReturnTo(payload.returnTo)
      : "/dashboard";
  const authenticatedAt = new Date(authenticatedAtText);

  if (
    !id ||
    provider !== "GOOGLE" ||
    !subject ||
    !email ||
    emailVerified !== true ||
    !Number.isFinite(authenticatedAt.getTime()) ||
    !payload.exp
  ) {
    throw new Error("GOOGLE_REGISTRATION_INTENT_INVALID");
  }

  return Object.freeze({
    id,
    provider: "GOOGLE",
    subject,
    email,
    emailVerified: true,
    name,
    authenticatedAt,
    returnTo,
    expiresAt: new Date(payload.exp * 1000),
  });
}
