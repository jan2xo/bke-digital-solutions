import "dotenv/config";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { signInGoogleTestUser } from "./google-session-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator can request a backup dry run while customers fail closed", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `backup-browser-${suffix}@bke.test`;
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", } });
  await signInGoogleTestUser(page, email, db);
  await page.goto("/admin/backups");
  await expect(page.getByRole("heading", { name: "Backups" })).toBeVisible();
  const response = page.waitForResponse((item) => item.url().endsWith("/api/admin/backups") && item.request().method() === "POST");
  await page.getByRole("button", { name: "Dry run" }).click();
  expect((await response).status()).toBe(202);
  await expect(page.getByText("Dry run queued.")).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(async () => (await fetch("/api/admin/backups")).status)).toBe(401);
  const backups = await db.backupArchive.findMany({ where: { operations: { some: { requestedById: admin.id } } }, select: { id: true } });
  await db.auditLog.deleteMany({ where: { actorId: admin.id } });
  await db.backupOperation.deleteMany({ where: { requestedById: admin.id } });
  await db.backupArchive.deleteMany({ where: { id: { in: backups.map((item) => item.id) } } });
  await db.user.delete({ where: { id: admin.id } });
});
