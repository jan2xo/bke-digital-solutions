import "dotenv/config";
import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { enrollAndLoginAdmin } from "./mfa-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("admin publishes a sanitized legal version and a customer completes required reacceptance", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const adminEmail = `legal-admin-${suffix}@bke.test`;
  const customerEmail = `legal-customer-${suffix}@bke.test`;
  const password = "Legal-Browser-2026!";
  await db.user.create({ data: { email: adminEmail, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  const customer = await db.user.create({ data: { email: customerEmail, name: "Legal Browser Customer", emailVerified: new Date(), credential: { create: { passwordHash: await argon2.hash(password) } }, ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Legal Browser Customer", billingEmail: customerEmail } } } });
  await enrollAndLoginAdmin(page, adminEmail, password);

  await page.goto("/admin/legal");
  await page.getByLabel("Title", { exact: true }).first().fill("Browser Legal Notice");
  await page.getByLabel("Slug", { exact: true }).fill(`browser-legal-${suffix}`);
  await page.getByLabel("Type", { exact: true }).fill(`BROWSER_LEGAL_${suffix.toUpperCase()}`);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page.getByRole("heading", { name: "Browser Legal Notice" })).toBeVisible();
  await page.getByLabel("Change summary").first().fill("Initial browser template");
  await page.getByLabel("Markdown").first().fill("# Browser Notice\n\nTemplate for {{company_name}}.\n\n<script>window.__legalXss = true</script>");
  await page.getByLabel("Require existing users to accept after publication").check();
  await page.getByRole("button", { name: "Preview" }).first().click();
  await expect(page.getByText('<script>window.__legalXss = true</script>')).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __legalXss?: boolean }).__legalXss)).toBeUndefined();
  const createDraftResponse = page.waitForResponse((response) => response.url().includes("/api/admin/legal/") && response.url().endsWith("/versions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create draft" }).click();
  expect((await createDraftResponse).status()).toBe(201);
  const version = await db.legalDocumentVersion.findFirstOrThrow({ where: { document: { slug: `browser-legal-${suffix}` }, status: "DRAFT" } });
  const publishResponse = page.waitForResponse((response) => response.url().endsWith(`/api/admin/legal/versions/${version.id}`) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Publish" }).click();
  expect((await publishResponse).status()).toBe(200);
  await page.goto(`/legal/browser-legal-${suffix}`);
  await expect(page.getByRole("heading", { name: "Browser Legal Notice" })).toBeVisible();
  await expect(page.getByText("Template for BKE Digital Solutions.")).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __legalXss?: boolean }).__legalXss)).toBeUndefined();

  await page.goto("/admin/legal");
  const immutableDelete = await page.request.delete(`/api/admin/legal/versions/${version.id}`, { headers: { origin: "http://127.0.0.1:3000" } });
  expect(immutableDelete.status()).toBe(409);
  await page.getByRole("button", { name: "Log out" }).click();
  expect(await page.evaluate(async () => (await fetch("/api/admin/legal")).status)).toBe(401);

  await page.getByLabel("Email address").first().fill(customerEmail);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/legal\/accept/);
  expect(await page.evaluate(async () => (await fetch("/api/orders/cm00000000000000000000000")).status)).toBe(409);
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  const acceptanceResponse = page.waitForResponse((response) => response.url().endsWith("/api/legal/accept") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Accept and continue" }).click();
  expect((await acceptanceResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
  expect(await db.legalAcceptance.count({ where: { userId: customer.id, documentVersionId: version.id, acceptanceContext: "REACCEPTANCE" } })).toBe(1);
});
