import "dotenv/config";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { signInGoogleTestUser } from "./google-session-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator manages only their own sessions and revocation takes effect on the next request", async ({ page, browser }) => {
  const suffix = Date.now().toString(36); const email = `security-admin-${suffix}@bke.test`;
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", } });
  await signInGoogleTestUser(page, email, db);
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin }); const secondPage = await secondContext.newPage();
  const secondSession = await signInGoogleTestUser(secondPage, email, db);
  await expect(secondPage).toHaveURL(/admin/);
  const sessions = await db.session.findMany({ where: { userId: admin.id, revokedAt: null }, orderBy: { createdAt: "asc" } });
  expect(sessions).toHaveLength(2);
  const currentCookie = (await page.context().cookies()).find((cookie) => cookie.name.includes("bke_session"));
  expect(currentCookie).toBeTruthy();
  const secondTarget = sessions.find((session) => session.id === secondSession.sessionId)!;
  const revoked = await page.request.post("/api/admin/security/sessions", { headers: { origin: "http://127.0.0.1:3000" }, data: { action: "ONE", sessionId: secondTarget.id } });
  expect(revoked.status()).toBe(200);
  await secondPage.goto("/admin/security"); await expect(secondPage).toHaveURL(/login/);
  await page.goto("/admin/security"); await expect(page.getByRole("heading", { name: "Security dashboard" })).toBeVisible(); await expect(page.getByText("(current session)")).toBeVisible();
  const all = await page.request.post("/api/admin/security/sessions", { headers: { origin: "http://127.0.0.1:3000" }, data: { action: "ALL", confirmation: "REVOKE ALL SESSIONS" } });
  expect(all.status()).toBe(200); expect((await all.json()).signedOut).toBe(true);
  await page.goto("/admin/security"); await expect(page).toHaveURL(/login/);
  await secondContext.close();
});
