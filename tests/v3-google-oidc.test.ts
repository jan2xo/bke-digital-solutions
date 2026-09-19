import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, generateKeyPair } from "jose";
import {
  assertGoogleOidcState,
  createGoogleOidcAuthorizationRequest,
  createGooglePkceChallenge,
  exchangeGoogleAuthorizationCode,
  normalizeGoogleOidcReturnTo,
  readGoogleOidcTransaction,
  verifyGoogleIdToken,
} from "@/apps/web/auth/google-oidc";

const config = {
  clientId: "1234567890-example.apps.googleusercontent.com",
  redirectUri: "https://commerce.bke.example/api/auth/google/callback",
  transactionSecret: "g".repeat(64),
};

describe("V3 Google OIDC host transport", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("creates an encrypted state + nonce + PKCE authorization transaction", async () => {
    const request = await createGoogleOidcAuthorizationRequest({ ...config, returnTo: "/dashboard/products?tab=mine" });
    const url = new URL(request.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(request.authorizationUrl).not.toContain("client_secret");
    expect(request.transactionToken).not.toContain(request.state);

    const transaction = await readGoogleOidcTransaction(request.transactionToken, config.transactionSecret);
    expect(transaction.returnTo).toBe("/dashboard/products?tab=mine");
    expect(url.searchParams.get("nonce")).toBe(transaction.nonce);
    expect(url.searchParams.get("code_challenge")).toBe(createGooglePkceChallenge(transaction.codeVerifier));
    expect(() => assertGoogleOidcState(request.state, transaction.state)).not.toThrow();
  });

  it("rejects tampered transaction state and external return targets", async () => {
    const request = await createGoogleOidcAuthorizationRequest({ ...config, returnTo: "https://evil.example/steal" });
    await expect(readGoogleOidcTransaction(request.transactionToken + "tamper", config.transactionSecret)).rejects.toThrow();
    expect(normalizeGoogleOidcReturnTo("//evil.example/steal")).toBe("/dashboard");
    expect(normalizeGoogleOidcReturnTo("https://evil.example/steal")).toBe("/dashboard");
    expect(() => assertGoogleOidcState("wrong-state", request.state)).toThrow("GOOGLE_OIDC_STATE_MISMATCH");
  });

  it("exchanges the authorization code with the server-only PKCE verifier", async () => {
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code")).toBe("authorization-code");
      expect(body.get("code_verifier")).toBe("v".repeat(64));
      expect(body.get("client_secret")).toBe("google-client-secret");
      expect(body.get("grant_type")).toBe("authorization_code");
      return new Response(JSON.stringify({ id_token: "signed-id-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await expect(exchangeGoogleAuthorizationCode({
      code: "authorization-code",
      codeVerifier: "v".repeat(64),
      clientId: config.clientId,
      clientSecret: "google-client-secret",
      redirectUri: config.redirectUri,
      fetchImpl: fakeFetch as typeof fetch,
    })).resolves.toEqual({ idToken: "signed-id-token" });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("verifies RS256 issuer, audience, nonce and identity claims", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const now = Math.floor(Date.now() / 1000);
    const nonce = "nonce-value";
    const token = await new SignJWT({
      email: "Buyer@Example.com",
      email_verified: true,
      name: "Buyer",
      nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience(config.clientId)
      .setSubject("google-subject-123")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);

    await expect(verifyGoogleIdToken({
      idToken: token,
      clientId: config.clientId,
      expectedNonce: nonce,
      verificationKey: publicKey,
    })).resolves.toMatchObject({
      provider: "GOOGLE",
      subject: "google-subject-123",
      email: "buyer@example.com",
      emailVerified: true,
      name: "Buyer",
    });

    await expect(verifyGoogleIdToken({
      idToken: token,
      clientId: config.clientId,
      expectedNonce: "different-nonce",
      verificationKey: publicKey,
    })).rejects.toThrow("GOOGLE_OIDC_NONCE_MISMATCH");
  });
});
