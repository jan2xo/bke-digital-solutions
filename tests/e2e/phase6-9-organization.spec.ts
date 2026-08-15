import "dotenv/config";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

test.afterAll(() => db.$disconnect());

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").first().fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
}

test("organization membership is visible in the browser and isolated across accounts", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const password = "Phase69-Browser-2026!";
  const ownerEmail = `phase69-owner-${suffix}@bke.test`;
  const memberEmail = `phase69-member-${suffix}@bke.test`;
  const outsiderEmail = `phase69-outsider-${suffix}@bke.test`;
  const passwordHash = await argon2.hash(password);
  const [owner, member, outsider] = await Promise.all([
    db.user.create({ data: { email: ownerEmail, emailVerified: new Date(), credential: { create: { passwordHash } } } }),
    db.user.create({ data: { email: memberEmail, emailVerified: new Date(), credential: { create: { passwordHash } } } }),
    db.user.create({ data: { email: outsiderEmail, emailVerified: new Date(), credential: { create: { passwordHash } } } }),
  ]);
  const organization = await db.customerAccount.create({ data: { type: "ORGANIZATION", displayName: `Phase 6.9 ${suffix}`, ownerId: owner.id, billingEmail: ownerEmail, organization: { create: { legalName: `Phase 6.9 Legal ${suffix}` } }, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const token = `phase69-${suffix}`;
  await db.invitation.create({ data: { accountId: organization.id, email: memberEmail, role: "LICENSE_MANAGER", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) } });
  await db.membership.create({ data: { accountId: organization.id, userId: member.id, role: "LICENSE_MANAGER" } });
  const limitedEmail = `phase69-limited-${suffix}@bke.test`;
  const limited = await db.user.create({ data: { email: limitedEmail, emailVerified: new Date(), credential: { create: { passwordHash } } } });
  await db.membership.create({ data: { accountId: organization.id, userId: limited.id, role: "MEMBER" } });

  await login(page, ownerEmail, password);
  await expect(page.getByText(organization.displayName)).toBeVisible();
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page.getByRole("heading", { name: organization.displayName })).toBeVisible();
  await expect(page.getByText("ORGANIZATION · OWNER")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, memberEmail, password);
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page.getByRole("heading", { name: organization.displayName })).toBeVisible();
  await expect(page.getByText("ORGANIZATION · LICENSE_MANAGER")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, limitedEmail, password);
  await expect(page.getByText("Limited member access. Billing and licensing records are hidden.")).toBeVisible();
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page.getByText("ORGANIZATION · MEMBER")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order history" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Subscriptions" })).not.toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, outsiderEmail, password);
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page).toHaveURL(/dashboard$/);
  await expect(page.getByText(organization.displayName)).not.toBeVisible();
});
