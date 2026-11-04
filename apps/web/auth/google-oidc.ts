import "server-only";

import * as oauth from "oauth4webapi";
import { EncryptJWT, jwtDecrypt } from "jose";
import { getWebHostEnvironment } from "@/apps/web/config/environment";
import { safeLocalRedirect } from "@/apps/web/security/redirect";
import { consumeOneTimeKey } from "@/apps/web/http/rate-limit";

const GOOGLE_ISSUER_VALUE = "https://accounts.google.com";
const GOOGLE_ISSUER = new URL(GOOGLE_ISSUER_VALUE);
const GOOGLE_LOGIN_CONTEXT_ISSUER = "bke-digital-solutions";
const GOOGLE_LOGIN_CONTEXT_AUDIENCE = "google-oidc-login";
const GOOGLE_LOGIN_CONTEXT_TTL_SECONDS = 600;

export const GOOGLE_LOGIN_CONTEXT_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-bke_google_login"
    : "bke_google_login";

export type GoogleLoginFlow = "login" | "register";

export interface GoogleLoginContext {
  readonly flow: GoogleLoginFlow;
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly legalVersionIds: readonly string[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing Google sign-in configuration: ${name}`);
  return value;
}

export function googleClientId(): string {
  return requiredEnvironment("GOOGLE_CLIENT_ID");
}

export function googleRedirectUri(): string {
  const appUrl = new URL(getWebHostEnvironment().appUrl);
  if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
    throw new Error("Google sign-in requires a configured HTTPS APP_URL.");
  }
  return new URL("/api/auth/google/callback", appUrl).toString();
}

function randomBase64Url(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loginContextKey(): Promise<Uint8Array> {
  const secret = requiredEnvironment("SESSION_SECRET");
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
  );
}

let metadataPromise: Promise<oauth.AuthorizationServer> | undefined;

async function googleAuthorizationServer(): Promise<oauth.AuthorizationServer> {
  metadataPromise ??= oauth
    .discoveryRequest(GOOGLE_ISSUER)
    .then((response) => oauth.processDiscoveryResponse(GOOGLE_ISSUER, response))
    .then((metadata) => {
      if (metadata.issuer !== GOOGLE_ISSUER_VALUE) {
        throw new Error("Google OIDC issuer metadata did not match the configured issuer.");
      }
      return metadata;
    })
    .catch((error) => {
      metadataPromise = undefined;
      throw error;
    });
  return metadataPromise;
}

export async function createGoogleAuthorizationRequest(input: {
  readonly flow: GoogleLoginFlow;
  readonly legalVersionIds?: readonly string[];
  readonly returnTo?: string;
}): Promise<{
  readonly authorizationUrl: string;
  readonly encryptedContext: string;
}> {
  const clientId = googleClientId();
  const redirectUri = googleRedirectUri();
  const state = randomBase64Url();
  const nonce = randomBase64Url();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const metadata = await googleAuthorizationServer();
  const client: oauth.Client = {
    client_id: clientId,
    id_token_signed_response_alg: "RS256",
  };
  const authorizationUrl = new URL(metadata.authorization_endpoint!);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const context: GoogleLoginContext = {
    flow: input.flow,
    state,
    nonce,
    codeVerifier,
    returnTo: safeLocalRedirect(input.returnTo),
    legalVersionIds: input.flow === "register" ? [...(input.legalVersionIds ?? [])] : [],
  };
  const encryptedContext = await new EncryptJWT({ ...context })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(GOOGLE_LOGIN_CONTEXT_ISSUER)
    .setAudience(GOOGLE_LOGIN_CONTEXT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${GOOGLE_LOGIN_CONTEXT_TTL_SECONDS}s`)
    .encrypt(await loginContextKey());

  return { authorizationUrl: authorizationUrl.toString(), encryptedContext };
}

export async function completeGoogleAuthorization(requestUrl: string, encryptedContext: string) {
  const { payload } = await jwtDecrypt(encryptedContext, await loginContextKey(), {
    issuer: GOOGLE_LOGIN_CONTEXT_ISSUER,
    audience: GOOGLE_LOGIN_CONTEXT_AUDIENCE,
    maxTokenAge: GOOGLE_LOGIN_CONTEXT_TTL_SECONDS,
  });
  const context = payload as unknown as GoogleLoginContext;
  if (
    !context ||
    (context.flow !== "login" && context.flow !== "register") ||
    typeof context.state !== "string" ||
    typeof context.nonce !== "string" ||
    typeof context.codeVerifier !== "string" ||
    !Array.isArray(context.legalVersionIds)
  ) {
    throw new Error("INVALID_GOOGLE_LOGIN_CONTEXT");
  }

  const callbackUrl = new URL(requestUrl);
  const metadata = await googleAuthorizationServer();
  const clientId = googleClientId();
  const client: oauth.Client = {
    client_id: clientId,
    id_token_signed_response_alg: "RS256",
  };
  const callbackParameters = oauth.validateAuthResponse(
    metadata,
    client,
    callbackUrl,
    context.state,
  );
  const stateDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(context.state));
  const contextKey = Array.from(new Uint8Array(stateDigest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!(await consumeOneTimeKey(`google-login-context:${contextKey}`, GOOGLE_LOGIN_CONTEXT_TTL_SECONDS))) {
    throw new Error("INVALID_GOOGLE_LOGIN_CONTEXT");
  }

  const tokenEndpointResponse = await oauth.authorizationCodeGrantRequest(
    metadata,
    client,
    oauth.ClientSecretPost(requiredEnvironment("GOOGLE_CLIENT_SECRET")),
    callbackParameters,
    googleRedirectUri(),
    context.codeVerifier,
  );
  const processedResponse = await oauth.processAuthorizationCodeResponse(
    metadata,
    client,
    tokenEndpointResponse,
    { expectedNonce: context.nonce, requireIdToken: true },
  );

  // The library validates the protocol response, but this consumer also requires
  // an explicit ID-token JWS signature check before trusting the subject.
  await oauth.validateApplicationLevelSignature(metadata, tokenEndpointResponse);
  const claims = oauth.getValidatedIdTokenClaims(processedResponse);
  if (
    !claims ||
    claims.iss !== GOOGLE_ISSUER_VALUE ||
    !(claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId))) ||
    typeof claims.sub !== "string" ||
    !/^[\x21-\x7e]{1,255}$/.test(claims.sub)
  ) {
    throw new Error("INVALID_GOOGLE_ID_TOKEN");
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  const emailVerified = claims.email_verified === true;
  const name = typeof claims.name === "string" ? claims.name.trim().slice(0, 100) : null;
  return {
    context,
    identity: {
      issuer: GOOGLE_ISSUER_VALUE,
      subject: claims.sub,
      email,
      emailVerified,
      name: name || null,
    },
  };
}
