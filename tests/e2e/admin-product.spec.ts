import "dotenv/config";
import argon2 from "argon2";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator creates, uploads, publishes, and edits a product", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `admin-${suffix}@bke.test`;
  const password = "Admin-Browser-2026!";
  await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await page.goto("/login");
  await page.getByLabel("Email address").first().fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/admin\/products/);

  const slug = `admin-mvp-${suffix}`;
  await page.getByLabel("Name", { exact: true }).first().fill("Admin MVP Product");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Short description").fill("A secure browser-created MVP product.");
  await page.getByLabel("Long description").fill("A secure software product created through the administrator portal.");
  await page.getByLabel("Price (PHP)").fill("499");
  await page.getByRole("button", { name: "Create draft product" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Admin MVP Product" }).first()).toBeVisible();

  const product = await db.product.findUniqueOrThrow({ where: { slug } });
  const update = await page.request.patch(`/api/admin/products/${product.id}`, { headers:{origin:"http://127.0.0.1:3000"},data: { summary: "An updated secure browser-created MVP product." } });
  expect(update.status()).toBe(200);
  const upload = await page.request.post(`/api/admin/products/${product.id}/versions`, { headers:{origin:"http://127.0.0.1:3000"},multipart: { version: "1.2.3", operatingSystem: "Windows", architecture: "x64", releaseNotes: "First secure release", publish: "true", latest: "true", installer: { name: "bke-mvp.zip", mimeType: "application/zip", buffer: Buffer.from("BKE MVP installer fixture") } } });
  expect(upload.status()).toBe(201);
  await page.reload();
  const productCard=page.locator("section.card").filter({hasText:`/${slug}`});
  await expect(productCard.getByText("1.2.3 · Windows x64 · Published · Latest")).toBeVisible();
  await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/api/admin/products/${product.id}`)&&r.request().method()==="PATCH"),productCard.getByRole("button", { name: "Publish",exact:true }).click()]);
  await expect(productCard.getByText("Published", { exact: true }).first()).toBeVisible();
  expect(await db.auditLog.count({ where: { targetId: product.id } })).toBeGreaterThanOrEqual(3);
});
