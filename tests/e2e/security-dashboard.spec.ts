import "dotenv/config";
import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { emailOtpCode, enrollAndLoginAdmin } from "./mfa-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator manages only their own sessions and revocation takes effect on the next request", async ({ page, browser }) => {
  const suffix = Date.now().toString(36); const email = `security-admin-${suffix}@bke.test`; const password = "Security-Dashboard-2026!";
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  const secondContext = await browser.newContext(); const secondPage = await secondContext.newPage();
  await secondPage.goto("/login"); await secondPage.getByLabel("Email address").first().fill(email); await secondPage.locator('input[name="password"]').fill(password); await secondPage.getByRole("button", { name: "Sign in" }).click();await expect(secondPage).toHaveURL(/login\/mfa/); await secondPage.getByLabel("Email or recovery code").fill(await emailOtpCode(secondPage)); await secondPage.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(secondPage).toHaveURL(/admin/);
  const sessions = await db.session.findMany({ where: { userId: admin.id, revokedAt: null }, orderBy: { createdAt: "asc" } });
  expect(sessions).toHaveLength(2);
  const currentCookie = (await page.context().cookies()).find((cookie) => cookie.name.includes("bke_session"));
  expect(currentCookie).toBeTruthy();
  const secondTarget = sessions[1]!;
  const revoked = await page.request.post("/api/admin/security/sessions", { headers: { origin: "http://127.0.0.1:3000" }, data: { action: "ONE", sessionId: secondTarget.id } });
  expect(revoked.status()).toBe(200);
  await secondPage.goto("/admin/security"); await expect(secondPage).toHaveURL(/login/);
  await page.goto("/admin/security"); await expect(page.getByRole("heading", { name: "Security dashboard" })).toBeVisible(); await expect(page.getByText("(current session)")).toBeVisible();
  const all = await page.request.post("/api/admin/security/sessions", { headers: { origin: "http://127.0.0.1:3000" }, data: { action: "ALL", confirmation: "REVOKE ALL SESSIONS" } });
  expect(all.status()).toBe(200); expect((await all.json()).signedOut).toBe(true);
  await page.goto("/admin/security"); await expect(page).toHaveURL(/login/);
  await secondContext.close();
});
