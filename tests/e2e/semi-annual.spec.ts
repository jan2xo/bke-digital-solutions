import "dotenv/config";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("browser selects canonical monthly, six-month and annual plans with independent pricing", async ({ page }) => {
  const slug = `semi-browser-${randomUUID()}`;
  const product = await db.product.create({ data: { slug, name: "Six-month selection fixture", summary: "Test fixture", description: "Disposable test product; rates are synthetic.", type: "SAAS", active: true } });
  const edition = await db.edition.create({ data: { productId: product.id, name: "Standard", slug: "standard", features: [], maxUsers: 1, maxDevicesPerUser: 1, updatePolicy: "ACTIVE_TERM", active: true } });
  const monthly = await db.purchasePlan.create({ data: { editionId: edition.id, type: "MONTHLY", amountMinor: 10_000, renewalBehavior: "CUSTOMER_AUTHORIZED", active: true } });
  // Test fixture only; no production/default commercial rate is seeded.
  const semi = await db.purchasePlan.create({ data: { editionId: edition.id, type: "SEMI_ANNUAL", monthlySourcePlanId: monthly.id, semiAnnualDiscountBps: 500, renewalBehavior: "CUSTOMER_AUTHORIZED", active: true } });
  const annual = await db.purchasePlan.create({ data: { editionId: edition.id, type: "ANNUAL", monthlySourcePlanId: monthly.id, annualDiscountBps: 1_000, renewalBehavior: "CUSTOMER_AUTHORIZED", active: true } });
  const response = await page.goto(`/products/${slug}`);
  expect(response?.status()).toBe(200);
  const cases = [
    { id: monthly.id, label: "Monthly", price: "100.00/month" },
    { id: semi.id, label: "6 Months — Semi-annual", price: "570.00/6 months" },
    { id: annual.id, label: "Annual", price: "1,080.00/year" },
  ];
  for (const item of cases) {
    const radio = page.locator(`input[name="purchase-plan"][value="${item.id}"]`);
    await radio.check();
    await expect(radio).toBeChecked();
    await expect(radio.locator("..").locator("..")).toContainText(item.label);
    await expect(radio.locator("..").locator("..")).toContainText(item.price);
    const destination = `/checkout?purchasePlanId=${encodeURIComponent(item.id)}`;
    await expect(page.getByRole("link", { name: "Select plan and sign in" })).toHaveAttribute("href", `/login?returnTo=${encodeURIComponent(destination)}`);
  }
  await expect(page.locator(`input[value="${semi.id}"]`).locator("..").locator("..")).toContainText("Save 5%");
  await expect(page.locator(`input[value="${annual.id}"]`).locator("..").locator("..")).toContainText("Save 10%");
  await page.locator(`input[value="${semi.id}"]`).check();
  await page.getByRole("link", { name: "Select plan and sign in" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("returnTo") === `/checkout?purchasePlanId=${semi.id}`);
});
