import "dotenv/config";
import type { Page } from "@playwright/test";
import { IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID, type IdentitySessionIssuanceCapability } from "@bke/identity/contracts/session.contract";
import { IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID, type IdentityGooglePrincipalBindingCapability } from "@bke/identity/contracts/google-identity.contract";
import { createIdentityModule } from "../../modules/identity/module";
import { composeCapabilities } from "../../platform/composition/composer";
import { assertGoogleFixtureEnvironment } from "./google-fixture-policy";
import type { PrismaClient } from "../../platform/host/generated/prisma/client";

type TestDatabase = PrismaClient;
/** Synthetic Google-bound session fixture. This does not prove provider authentication or signed Google claims. */
export async function signInGoogleTestUser(page: Page, email: string, db: TestDatabase): Promise<{ userId: string; sessionId: string }> {
  assertGoogleFixtureEnvironment(process.env, process.env.APP_URL ?? "http://127.0.0.1:3000");
  await page.goto("/");
  const origin = new URL(page.url());
  assertGoogleFixtureEnvironment(process.env, origin.origin);
  const user = await db.user.findUnique({ where: { email }, select: { id: true, role: true, lifecycleState: true, suspendedAt: true, googleIdentity: { select: { userId: true } } } });
  if (!user) throw new Error("Create the E2E user fixture before issuing its session.");
  if (user.lifecycleState !== "ACTIVE" || user.suspendedAt) throw new Error("Google session fixtures require an active, unsuspended principal.");
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.length < 32) throw new Error("A test session secret is required.");
  const application = await composeCapabilities([
    createIdentityModule({ connectionString: process.env.DATABASE_URL!, sessionSecret }),
  ]);
  if (!user.googleIdentity) {
    const binding = application.get<IdentityGooglePrincipalBindingCapability>(IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID);
    const result = await binding.bindToUser({ userId: user.id, subject: `bke-e2e-test-subject:${user.id}` });
    if (result.status !== "BOUND") throw new Error("Could not bind E2E Google subject.");
  }
  const issuance = application.get<IdentitySessionIssuanceCapability>(IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID);
  const issued = await issuance.issue({ userId: user.id, authenticationMethod: "GOOGLE_OIDC", userAgentSummary: "E2E synthetic Google-bound browser session", networkHint: "127.0.0.1" });
  if (issued.status !== "ISSUED") throw new Error("Could not issue E2E Google-bound session.");
  // Fixture recency is synthetic test state, not provider auth_time evidence.
  const now = new Date();
  await db.session.update({ where: { id: issued.session.id }, data: { recentAuthenticatedAt: now, assuranceLevel: "RECENTLY_AUTHENTICATED", mfaVerifiedAt: null } });
  await page.context().addCookies([{ name: "bke_session", value: issued.token, url: origin.origin, expires: Math.floor(issued.session.expiresAt.getTime() / 1000), httpOnly: true, secure: origin.protocol === "https:", sameSite: "Lax" }]);
  await page.goto(user.role === "ADMIN" ? "/admin" : "/dashboard");
  return { userId: user.id, sessionId: issued.session.id };
}
