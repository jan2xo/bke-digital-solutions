import "dotenv/config";
import argon2 from "argon2";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { enrollAndLoginAdmin } from "./mfa-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator operates the scheduler while non-administrators fail closed", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `scheduler-browser-${suffix}@bke.test`;
  const password = "Scheduler-Browser-2026!";
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  await page.goto("/admin/scheduler");
  await expect(page.getByRole("heading", { name: "Scheduler" })).toBeVisible();
  const card = page.locator("article").filter({ hasText: "Transactional email outbox" });
  await expect(card.getByText(/healthy|degraded|unhealthy/).first()).toBeVisible();
  const dryResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/scheduler") && response.request().method() === "POST");
  await card.getByRole("button", { name: "Dry run" }).click();
  expect((await dryResponse).status()).toBe(200);
  const pauseResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/scheduler") && response.request().method() === "POST");
  await card.getByRole("button", { name: "Pause" }).click(); expect((await pauseResponse).status()).toBe(200);
  await expect(card.getByRole("button", { name: "Resume" })).toBeVisible();
  const resumeResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/scheduler") && response.request().method() === "POST");
  await card.getByRole("button", { name: "Resume" }).click(); expect((await resumeResponse).status()).toBe(200);
  await expect(card.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(async () => (await fetch("/api/admin/scheduler")).status)).toBe(401);
  await db.auditLog.deleteMany({ where: { actorId: admin.id } });
  await db.user.delete({ where: { id: admin.id } });
});
