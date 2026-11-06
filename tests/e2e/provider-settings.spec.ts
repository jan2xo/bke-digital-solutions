import "dotenv/config";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { signInGoogleTestUser } from "./google-session-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("provider settings are administrator-only and live payments stay locked", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const adminEmail = `provider-admin-${suffix}@bke.test`;
  await db.user.create({ data: { email: adminEmail, emailVerified: new Date(), role: "ADMIN", } });
  await signInGoogleTestUser(page, adminEmail, db);
  await page.goto("/admin/providers");
  await expect(page.getByRole("heading", { name: "External providers" })).toBeVisible();
  await expect(page.getByText("No database credentials stored.")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "PayMongo live" })).toBeVisible();
  const live = await page.request.post("/api/admin/providers", { headers: { origin: "http://127.0.0.1:3000" }, data: { action: "SAVE", provider: "PAYMONGO", environment: "LIVE", secretKey: "sk_live_not-a-real-key", webhookSecret: "whsk_not-a-real-secret" } });
  expect(live.status()).toBe(403);
  expect(await live.json()).toEqual({ error: "PROVIDER_LIVE_MODE_FORBIDDEN" });
  await page.getByRole("button", { name: "Log out" }).click();

  const customerEmail = `provider-customer-${suffix}@bke.test`;
  await db.user.create({ data: { email: customerEmail, role: "CUSTOMER", emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Provider Customer", billingEmail: customerEmail } } } });
  await signInGoogleTestUser(page, customerEmail, db); await expect(page).toHaveURL(/dashboard/);
  await page.goto("/admin/providers");
  await expect(page).toHaveURL(/dashboard/);
  expect((await page.request.get("/api/admin/providers")).status()).toBe(403);
});
