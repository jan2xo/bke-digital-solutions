import "dotenv/config";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { signInGoogleTestUser } from "./google-session-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

test.afterAll(() => db.$disconnect());

test("organization membership is visible in the browser and isolated across accounts", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const ownerEmail = `phase69-owner-${suffix}@bke.test`;
  const memberEmail = `phase69-member-${suffix}@bke.test`;
  const outsiderEmail = `phase69-outsider-${suffix}@bke.test`;
  const [owner, member] = await Promise.all([
    db.user.create({ data: { email: ownerEmail, role: "CUSTOMER", emailVerified: new Date() } }),
    db.user.create({ data: { email: memberEmail, role: "CUSTOMER", emailVerified: new Date() } }),
    db.user.create({ data: { email: outsiderEmail, role: "CUSTOMER", emailVerified: new Date() } }),
  ]);
  const organization = await db.customerAccount.create({ data: { type: "ORGANIZATION", displayName: `Phase 6.9 ${suffix}`, ownerId: owner.id, billingEmail: ownerEmail, organization: { create: { legalName: `Phase 6.9 Legal ${suffix}` } }, memberships: { create: { userId: owner.id, role: "OWNER" } } } });
  const token = `phase69-${suffix}`;
  await db.invitation.create({ data: { accountId: organization.id, email: memberEmail, role: "LICENSE_MANAGER", tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) } });
  await db.membership.create({ data: { accountId: organization.id, userId: member.id, role: "LICENSE_MANAGER" } });
  const limitedEmail = `phase69-limited-${suffix}@bke.test`;
  const limited = await db.user.create({ data: { email: limitedEmail, role: "CUSTOMER", emailVerified: new Date() } });
  await db.membership.create({ data: { accountId: organization.id, userId: limited.id, role: "MEMBER" } });

  await signInGoogleTestUser(page, ownerEmail, db);
  await expect((await page.request.get("/api/organizations")).status()).toBe(200);
  await expect(page.getByText(organization.displayName)).toBeVisible();
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page.getByRole("heading", { name: organization.displayName })).toBeVisible();
  await expect(page.getByText("ORGANIZATION · OWNER")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await signInGoogleTestUser(page, memberEmail, db);
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page.getByRole("heading", { name: organization.displayName })).toBeVisible();
  await expect(page.getByText("ORGANIZATION · LICENSE_MANAGER")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await signInGoogleTestUser(page, limitedEmail, db);
  await expect(page.getByText("Limited member access. Billing and licensing records are hidden.")).toBeVisible();
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page.getByText("ORGANIZATION · MEMBER")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order history" })).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Subscriptions" })).not.toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await signInGoogleTestUser(page, outsiderEmail, db);
  const outsiderApi = await page.request.get(`/api/organizations/${organization.id}`);
  expect([403, 404]).toContain(outsiderApi.status());
  await page.goto(`/dashboard/accounts/${organization.id}`);
  await expect(page).toHaveURL(/dashboard$/);
  await expect(page.getByText(organization.displayName)).not.toBeVisible();
});
