import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  EncryptJWT,
  createRemoteJWKSet,
  jwtDecrypt,
  jwtVerify,
} from "jose";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const TRANSACTION_ISSUER = "bke-digital-solutions";
const TRANSACTION_AUDIENCE = "bke-google-oidc";
const TRANSACTION_TTL_SECONDS = 10 * 60;

export interface GoogleOidcTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly expiresAt: Date;
}

export interface VerifiedGoogleOidcIdentity {
  readonly provider: "GOOGLE";
  readonly subject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly authenticatedAt: Date;
}

function derivedTransactionKey(secret: string): Uint8Array {
  const normalized = secret.trim();
  if (normalized.length < 32) throw new Error("GOOGLE_OIDC_TRANSACTION_SECRET_REQUIRED");
  return createHash("sha256")
    .update("bke-google-oidc-transaction-v1\0", "utf8")
    .update(normalized, "utf8")
    .digest();
}

function opaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function normalizeGoogleOidcReturnTo(value?: string | null): string {
  const candidate = value?.trim() || "/dashboard";
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) return "/dashboard";

  try {
    const base = new URL("https://bke.invalid");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return "/dashboard";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/dashboard";
  }
}

export function createGooglePkceChallenge(codeVerifier: string): string {
  const normalized = codeVerifier.trim();
  if (normalized.length < 43 || normalized.length > 128) {
    throw new Error("INVALID_GOOGLE_OIDC_CODE_VERIFIER");
  }
  return createHash("sha256").update(normalized, "ascii").digest("base64url");
}

export async function createGoogleOidcAuthorizationRequest(input: Readonly<{
  clientId: string;
  redirectUri: string;
  transactionSecret: string;
  returnTo?: string | null;
}>): Promise<{
  readonly authorizationUrl: string;
  readonly transactionToken: string;
  readonly state: string;
  readonly expiresAt: Date;
}> {
  const clientId = input.clientId.trim();
  const redirectUri = input.redirectUri.trim();
  if (!clientId || !redirectUri) throw new Error("GOOGLE_OIDC_CONFIGURATION_INVALID");
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
    throw new Error("GOOGLE_OIDC_REDIRECT_URI_INSECURE");
  }

  const state = opaque();
  const nonce = opaque();
  const codeVerifier = opaque(48);
  const codeChallenge = createGooglePkceChallenge(codeVerifier);
  const returnTo = normalizeGoogleOidcReturnTo(input.returnTo);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = new Date((now + TRANSACTION_TTL_SECONDS) * 1000);

  const transactionToken = await new EncryptJWT({
    state,
    nonce,
    codeVerifier,
    returnTo,
  })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "bke-google-oidc-transaction+jwt" })
    .setIssuer(TRANSACTION_ISSUER)
    .setAudience(TRANSACTION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + TRANSACTION_TTL_SECONDS)
    .encrypt(derivedTransactionKey(input.transactionSecret));

  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirect.toString());
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return Object.freeze({
    authorizationUrl: authorizationUrl.toString(),
    transactionToken,
    state,
    expiresAt,
  });
}

export async function readGoogleOidcTransaction(
  token: string,
  transactionSecret: string,
): Promise<GoogleOidcTransaction> {
  if (!token.trim()) throw new Error("GOOGLE_OIDC_TRANSACTION_MISSING");
  const { payload, protectedHeader } = await jwtDecrypt(
    token,
    derivedTransactionKey(transactionSecret),
    {
      issuer: TRANSACTION_ISSUER,
      audience: TRANSACTION_AUDIENCE,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    },
  );
  if (protectedHeader.typ !== "bke-google-oidc-transaction+jwt") {
    throw new Error("GOOGLE_OIDC_TRANSACTION_INVALID");
  }

  const state = typeof payload.state === "string" ? payload.state : "";
  const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
  const codeVerifier = typeof payload.codeVerifier === "string" ? payload.codeVerifier : "";
  const returnTo = typeof payload.returnTo === "string" ? payload.returnTo : "";
  if (!state || !nonce || !codeVerifier || !returnTo || !payload.exp) {
    throw new Error("GOOGLE_OIDC_TRANSACTION_INVALID");
  }

  return Object.freeze({
    state,
    nonce,
    codeVerifier,
    returnTo: normalizeGoogleOidcReturnTo(returnTo),
    expiresAt: new Date(payload.exp * 1000),
  });
}

function secureEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest();
  const b = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function assertGoogleOidcState(received: string | null | undefined, expected: string): void {
  if (!received || !secureEqual(received, expected)) {
    throw new Error("GOOGLE_OIDC_STATE_MISMATCH");
  }
}

export async function exchangeGoogleAuthorizationCode(input: Readonly<{
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}>): Promise<{ readonly idToken: string }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      code_verifier: input.codeVerifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("GOOGLE_OIDC_TOKEN_EXCHANGE_FAILED");

  const body = await response.json() as { id_token?: unknown };
  if (typeof body.id_token !== "string" || !body.id_token) {
    throw new Error("GOOGLE_OIDC_ID_TOKEN_MISSING");
  }
  return Object.freeze({ idToken: body.id_token });
}

export async function verifyGoogleIdToken(input: Readonly<{
  idToken: string;
  clientId: string;
  expectedNonce: string;
  verificationKey?: CryptoKey;
}>): Promise<VerifiedGoogleOidcIdentity> {
  const key = input.verificationKey ?? GOOGLE_JWKS;
  const { payload } = await jwtVerify(input.idToken, key, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: input.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "iat", "exp"],
    maxTokenAge: "10m",
    clockTolerance: 5,
  });

  const nonce = typeof payload.nonce === "string" ? payload.nonce : "";
  if (!nonce || !secureEqual(nonce, input.expectedNonce)) {
    throw new Error("GOOGLE_OIDC_NONCE_MISMATCH");
  }
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null;
  if (!subject || !email || !payload.iat) throw new Error("GOOGLE_OIDC_IDENTITY_CLAIMS_INVALID");

  return Object.freeze({
    provider: "GOOGLE",
    subject,
    email,
    emailVerified: payload.email_verified === true,
    name,
    authenticatedAt: new Date(payload.iat * 1000),
  });
}
