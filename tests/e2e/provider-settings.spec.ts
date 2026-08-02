import "dotenv/config";
import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { enrollAndLoginAdmin } from "./mfa-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("provider settings are administrator-only and live payments stay locked", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const password = "Provider-Admin-2026!";
  const adminEmail = `provider-admin-${suffix}@bke.test`;
  await db.user.create({ data: { email: adminEmail, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, adminEmail, password);
  await page.goto("/admin/providers");
  await expect(page.getByRole("heading", { name: "External providers" })).toBeVisible();
  await expect(page.getByText("No database credentials stored.")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "PayMongo live" })).toBeVisible();
  const live = await page.request.post("/api/admin/providers", { headers: { origin: "http://127.0.0.1:3000" }, data: { action: "SAVE", provider: "PAYMONGO", environment: "LIVE", secretKey: "sk_live_not-a-real-key", webhookSecret: "whsk_not-a-real-secret" } });
  expect(live.status()).toBe(403);
  expect(await live.json()).toEqual({ error: "PROVIDER_LIVE_MODE_FORBIDDEN" });
  await page.getByRole("button", { name: "Log out" }).click();

  const customerEmail = `provider-customer-${suffix}@bke.test`;
  await db.user.create({ data: { email: customerEmail, emailVerified: new Date(), credential: { create: { passwordHash: await argon2.hash(password) } }, ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Provider Customer", billingEmail: customerEmail } } } });
  await page.goto("/login");
  await page.getByLabel("Email address").first().fill(customerEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/admin/providers");
  await expect(page).toHaveURL(/dashboard/);
  expect((await page.request.get("/api/admin/providers")).status()).toBe(403);
});
