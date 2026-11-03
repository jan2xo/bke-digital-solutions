import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EncryptJWT, exportJWK, generateKeyPair, jwtDecrypt, SignJWT, type KeyLike } from "jose";

const { mockEnvironment } = vi.hoisted(() => ({
  mockEnvironment: {
    nodeEnv: "test",
    appUrl: "https://jl-bke.com",
    trustedOrigins: ["https://jl-bke.com"],
    trustProxyHops: 1,
    redisKeyPrefix: "google-oidc-test",
  },
}));

vi.mock("../apps/web/config/environment", () => ({
  getWebHostEnvironment: () => mockEnvironment,
}));

const GOOGLE_ISSUER = "https://accounts.google.com";
const CLIENT_ID = "test-google-client.apps.googleusercontent.com";
const CLIENT_SECRET = "test-google-client-secret";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const metadata = {
  issuer: GOOGLE_ISSUER,
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: TOKEN_ENDPOINT,
  jwks_uri: JWKS_URI,
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
};

let signing: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongSigning: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
let tokenFactory: (nonce: string, privateKey?: KeyLike, claims?: { issuer?: string; audience?: string }) => Promise<string>;
let tokenEndpointCalls = 0;
let idToken: string;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeAll(async () => {
  process.env.APP_URL = "https://jl-bke.com";
  process.env.SESSION_SECRET = "a-test-only-session-secret-long-enough";
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  process.env.GOOGLE_CLIENT_SECRET = CLIENT_SECRET;

  signing = await generateKeyPair("RS256");
  wrongSigning = await generateKeyPair("RS256");
  publicJwk = {
    ...(await exportJWK(signing.publicKey)),
    kid: "google-test-key",
    use: "sig",
    alg: "RS256",
  };
  tokenFactory = async (nonce, privateKey = signing.privateKey, claims = {}) =>
    new SignJWT({
      nonce,
      email: "customer@example.test",
      email_verified: true,
      name: "Test Customer",
    })
      .setProtectedHeader({ alg: "RS256", kid: "google-test-key" })
      .setIssuer(claims.issuer ?? GOOGLE_ISSUER)
      .setAudience(claims.audience ?? CLIENT_ID)
      .setSubject("google-subject-123")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(rawUrl);
    if (url.href === "https://accounts.google.com/.well-known/openid-configuration") {
      return jsonResponse(metadata);
    }
    if (url.href === TOKEN_ENDPOINT) {
      tokenEndpointCalls += 1;
      return jsonResponse({
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken,
      });
    }
    if (url.href === JWKS_URI) return jsonResponse({ keys: [publicJwk] });
    throw new Error(`Unexpected OAuth test request: ${url.href}`);
  });
});

afterEach(() => {
  tokenEndpointCalls = 0;
});

async function startLogin() {
  const { createGoogleAuthorizationRequest } = await import("../apps/web/auth/google-oidc");
  const request = await createGoogleAuthorizationRequest({ flow: "login" });
  const key = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(process.env.SESSION_SECRET),
    ),
  );
  const { payload } = await jwtDecrypt(request.encryptedContext, key);
  const state = new URL(request.authorizationUrl).searchParams.get("state");
  if (!state || typeof payload.nonce !== "string") {
    throw new Error("Invalid test authorization request");
  }
  return {
    encryptedContext: request.encryptedContext,
    callbackUrl: `https://jl-bke.com/api/auth/google/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
    nonce: payload.nonce,
  };
}

describe("Google OIDC callback validation", () => {
  it("validates the canonical issuer and consumes a browser context only once", async () => {
    const login = await startLogin();
    idToken = await tokenFactory(login.nonce);
    const { completeGoogleAuthorization } = await import("../apps/web/auth/google-oidc");

    const result = await completeGoogleAuthorization(login.callbackUrl, login.encryptedContext);

    expect(result.identity).toMatchObject({
      issuer: GOOGLE_ISSUER,
      subject: "google-subject-123",
      email: "customer@example.test",
      emailVerified: true,
    });
    expect(tokenEndpointCalls).toBe(1);
    await expect(
      completeGoogleAuthorization(login.callbackUrl, login.encryptedContext),
    ).rejects.toThrow("INVALID_GOOGLE_LOGIN_CONTEXT");
    expect(tokenEndpointCalls).toBe(1);
  });

  it("rejects an ID token signed by a key outside the Google JWKS", async () => {
    const login = await startLogin();
    idToken = await tokenFactory(login.nonce, wrongSigning.privateKey);
    const { completeGoogleAuthorization } = await import("../apps/web/auth/google-oidc");

    await expect(
      completeGoogleAuthorization(login.callbackUrl, login.encryptedContext),
    ).rejects.toThrow();
  });

  it("rejects a nonce mismatch", async () => {
    const login = await startLogin();
    idToken = await tokenFactory("wrong-nonce");
    const { completeGoogleAuthorization } = await import("../apps/web/auth/google-oidc");
    await expect(completeGoogleAuthorization(login.callbackUrl, login.encryptedContext)).rejects.toThrow();
  });

  it.each([
    ["issuer", { issuer: "https://attacker.example" }],
    ["audience", { audience: "another-client.apps.googleusercontent.com" }],
  ])("rejects a wrong ID-token %s", async (_name, claims) => {
    const login = await startLogin();
    idToken = await tokenFactory(login.nonce, undefined, claims);
    const { completeGoogleAuthorization } = await import("../apps/web/auth/google-oidc");
    await expect(completeGoogleAuthorization(login.callbackUrl, login.encryptedContext)).rejects.toThrow();
  });

  it("rejects a state mismatch before exchanging the authorization code", async () => {
    const login = await startLogin();
    idToken = await tokenFactory(login.nonce);
    const { completeGoogleAuthorization } = await import("../apps/web/auth/google-oidc");
    const wrongState = login.callbackUrl.replace(/state=[^&]+/, "state=attacker-state");
    await expect(completeGoogleAuthorization(wrongState, login.encryptedContext)).rejects.toThrow();
    expect(tokenEndpointCalls).toBe(0);
  });

  it("rejects an expired encrypted login context", async () => {
    const login = await startLogin();
    const key = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(process.env.SESSION_SECRET)),
    );
    const { payload } = await jwtDecrypt(login.encryptedContext, key);
    const now = Math.floor(Date.now() / 1000);
    const expiredContext = await new EncryptJWT(payload)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setIssuer("bke-digital-solutions")
      .setAudience("google-oidc-login")
      .setIssuedAt(now - 700)
      .setExpirationTime(now - 1)
      .encrypt(key);
    const { completeGoogleAuthorization } = await import("../apps/web/auth/google-oidc");
    await expect(completeGoogleAuthorization(login.callbackUrl, expiredContext)).rejects.toThrow();
    expect(tokenEndpointCalls).toBe(0);
  });

});
