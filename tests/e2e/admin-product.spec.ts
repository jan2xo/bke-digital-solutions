import "dotenv/config";
import argon2 from "argon2";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { emailOtpCode, enrollAndLoginAdmin } from "./mfa-helper";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator MFA recovery is single-use and recent authentication is enforced", async ({ page }) => {
  const suffix = Date.now().toString(36);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.42.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}` });
  const email = `mfa-admin-${suffix}@bke.test`;
  const password = "Admin-MFA-2026!";
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  const { recoveryCodes } = await enrollAndLoginAdmin(page, email, password);
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByLabel("Email address").first().fill(email); await page.locator('input[name="password"]').fill(password); await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).toHaveURL(/login\/mfa/);
  await page.getByLabel("Email or recovery code").fill(recoveryCodes[0]!); await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/admin/);
  await page.getByRole("button", { name: "Log out" }).click();
  await page.getByLabel("Email address").first().fill(email); await page.locator('input[name="password"]').fill(password); await page.getByRole("button", { name: "Sign in" }).click(); await expect(page).toHaveURL(/login\/mfa/);
  await page.getByLabel("Email or recovery code").fill(recoveryCodes[0]!); await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByText("That code does not match the newest verification email.")).toBeVisible();
  await page.getByLabel("Email or recovery code").fill(await emailOtpCode(page)); await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page).toHaveURL(/admin/);
  await db.session.updateMany({ where: { userId: admin.id }, data: { recentAuthenticatedAt: new Date(Date.now() - 16 * 60_000) } });
  const denied = await page.request.get("/api/admin/audit/export");
  expect(denied.status()).toBe(403);
  await page.goto("/security/recent?returnTo=/admin/security");
  await page.locator('input[name="password"]').fill(password); const recentChallenge=page.waitForResponse((response)=>response.url().endsWith("/api/auth/mfa/challenge/request")&&response.request().method()==="POST");await page.getByRole("button",{name:"Email my verification code"}).click();expect((await recentChallenge).status()).toBe(200); await page.getByLabel("Email or recovery code").fill(await emailOtpCode(page)); const recentResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/recent") && response.request().method() === "POST"); await page.getByRole("button", { name: "Confirm identity" }).click(); expect((await recentResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/admin\/security$/);
  expect((await page.request.get("/api/admin/audit/export")).status()).toBe(200);
});

test("administrator creates, uploads, publishes, and edits a product", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `admin-${suffix}@bke.test`;
  const password = "Admin-Browser-2026!";
  await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page,email,password);
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/admin\/products/);

  const slug = `admin-mvp-${suffix}`;
  await page.getByLabel("Name", { exact: true }).first().fill("Admin MVP Product");
  await page.getByLabel("Slug", { exact: true }).fill(slug);
  await page.getByLabel("Short description").fill("A secure browser-created MVP product.");
  await page.getByLabel("Long description").fill("A secure software product created through the administrator portal.");
  await page.getByLabel("Perpetual price (PHP)").first().fill("499");
  const createdResponse=page.waitForResponse(r=>r.url().endsWith("/api/admin/products")&&r.request().method()==="POST");
  await page.getByRole("button", { name: "Create draft product" }).click();
  expect((await createdResponse).status()).toBe(201);
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
  for(const [path,heading] of [["/admin/releases","Release center"],["/admin/artifacts","Artifact manager"],["/admin/customers","Customer manager"],["/admin/licenses","License center"],["/admin/devices","Device manager"],["/admin/orders","Orders"],["/admin/invoices","Invoice center"],["/admin/audit","Audit center"]] as const){await page.goto(path);await expect(page.getByRole("heading",{name:heading})).toBeVisible()}
  const customer=await db.user.create({data:{email:`managed-${suffix}@bke.test`,emailVerified:new Date(),name:"Managed Customer",ownedAccounts:{create:{type:"INDIVIDUAL",displayName:"Managed Customer",billingEmail:`managed-${suffix}@bke.test`}}}});
  const suspended=await page.request.patch(`/api/admin/customers/${customer.id}`,{headers:{origin:"http://127.0.0.1:3000"},data:{action:"SUSPEND"}});expect(suspended.status()).toBe(200);expect((await db.user.findUniqueOrThrow({where:{id:customer.id}})).suspendedAt).not.toBeNull();expect(await db.auditLog.count({where:{targetId:customer.id,action:"CUSTOMER_SUSPEND"}})).toBe(1);
  expect((await page.request.patch(`/api/admin/customers/${customer.id}`,{headers:{origin:"http://127.0.0.1:3000"},data:{action:"REACTIVATE"}})).status()).toBe(200);
  await page.goto(`/admin/customers/${customer.id}`);
  await expect(page.getByRole("heading",{name:"Customer lifecycle and retention"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Execute final purge"})).toBeDisabled();
  expect((await page.request.patch(`/api/admin/customers/${customer.id}`,{headers:{origin:"http://127.0.0.1:3000"},data:{action:"CLOSE",confirmation:"CLOSE CUSTOMER ACCOUNT"}})).status()).toBe(200);
  expect(await db.customerAccount.count({where:{ownerId:customer.id,lifecycleState:"CLOSED"}})).toBe(1);
  expect((await page.request.patch(`/api/admin/customers/${customer.id}`,{headers:{origin:"http://127.0.0.1:3000"},data:{action:"LEGAL_HOLD",enabled:true,reason:"Browser test"}})).status()).toBe(200);
  const retention=await page.request.get(`/api/admin/customers/${customer.id}`);expect(retention.status()).toBe(200);expect((await retention.json()).blockers).toContain("LEGAL_HOLD");
  await page.getByRole("button",{name:"Log out"}).click();
  await expect(page).toHaveURL(/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/login/);
});

test("administrator permanently deletes only disposable archived products", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `delete-admin-${suffix}@bke.test`;
  const password = "Admin-Delete-2026!";
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page,email,password);

  const disposable = await db.product.create({ data: { slug: `disposable-${suffix}`, name: `Disposable ${suffix}`, summary: "A disposable browser test product.", description: "A disposable browser test product with no customer history.", type: "SOFTWARE", active: false } });
  const disposablePolicy = await db.licensePolicy.create({ data: { productId: disposable.id, name: "Disposable", maxSeats: 1, maxDevicesPerSeat: 1 } });
  await db.price.create({ data: { productId: disposable.id, licensePolicyId: disposablePolicy.id, name: "Disposable price", amountMinor: 10000, billingType: "ONE_TIME" } });

  await page.goto("/admin/products");
  let card = page.locator("section.card").filter({ hasText: `/${disposable.slug}` });
  await expect(card.getByRole("button", { name: "Delete permanently" })).toHaveCount(0);
  await card.getByRole("button", { name: "Archive" }).click();
  await expect(card.getByText("Archived", { exact: true }).first()).toBeVisible();
  await card.getByRole("button", { name: "Delete permanently" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete product permanently?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(db.product.findUnique({ where: { id: disposable.id } })).resolves.not.toBeNull();

  card = page.locator("section.card").filter({ hasText: `/${disposable.slug}` });
  const hostile = await page.request.delete(`/api/admin/products/${disposable.id}/deletion`, { headers: { origin: "https://evil.example" }, data: { confirmationName: disposable.name } });
  expect(hostile.status()).toBe(403);
  await card.getByRole("button", { name: "Delete permanently" }).click();
  await dialog.getByLabel(new RegExp(`Type ${disposable.name}`)).fill(disposable.name);
  await dialog.getByRole("button", { name: "Request deletion" }).click();
  await expect(dialog.getByText("Deletion requested.")).toBeVisible();
  await dialog.getByRole("button", { name: "Run cleanup and finalize" }).click();
  await expect(card).toHaveCount(0);
  expect(await db.product.findUnique({ where: { id: disposable.id } })).toBeNull();
  expect(await db.auditLog.count({ where: { actorId: admin.id, targetId: disposable.id, action: "PRODUCT_DELETION_FINALIZED" } })).toBe(1);
  const repeated = await page.request.delete(`/api/admin/products/${disposable.id}/deletion`, { headers: { origin: "http://127.0.0.1:3000" }, data: { confirmationName: disposable.name } });
  expect(repeated.status()).toBe(404);

  const blocked = await db.product.create({ data: { slug: `retained-${suffix}`, name: `Retained ${suffix}`, summary: "A retained browser test product.", description: "A retained browser test product with immutable order history.", type: "SOFTWARE", active: false, archivedAt: new Date() } });
  const blockedPolicy = await db.licensePolicy.create({ data: { productId: blocked.id, name: "Retained", maxSeats: 1, maxDevicesPerSeat: 1 } });
  const blockedPrice = await db.price.create({ data: { productId: blocked.id, licensePolicyId: blockedPolicy.id, name: "Retained price", amountMinor: 10000, billingType: "ONE_TIME" } });
  const customerEmail = `delete-customer-${suffix}@bke.test`;
  const customer = await db.user.create({ data: { email: customerEmail, emailVerified: new Date(), credential: { create: { passwordHash: await argon2.hash(password) } }, ownedAccounts: { create: { type: "INDIVIDUAL", displayName: "Delete customer", billingEmail: customerEmail } } }, include: { ownedAccounts: true } });
  const order = await db.order.create({ data: { number: `DEL-E2E-${suffix}`, accountId: customer.ownedAccounts[0]!.id, currency: "PHP", subtotalMinor: 10000, taxMinor: 0, totalMinor: 10000, billingSnapshot: {}, items: { create: { productId: blocked.id, priceId: blockedPrice.id, policyId: blockedPolicy.id, productName: blocked.name, priceName: blockedPrice.name, quantity: 1, unitAmountMinor: 10000, totalMinor: 10000, billingType: "ONE_TIME", policySnapshot: {} } } } });
  await page.reload();
  const blockedCard = page.locator("section.card").filter({ hasText: `/${blocked.slug}` });
  await blockedCard.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByRole("dialog").getByText("Orders: 1")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  const blockedResponse = await page.request.delete(`/api/admin/products/${blocked.id}/deletion`, { headers: { origin: "http://127.0.0.1:3000" }, data: { confirmationName: blocked.name } });
  expect(blockedResponse.status()).toBe(409);
  expect((await blockedResponse.json()).dependencies.orders).toBe(1);
  expect(await db.product.findUnique({ where: { id: blocked.id } })).not.toBeNull();
  expect(await db.order.findUnique({ where: { id: order.id } })).not.toBeNull();
  expect(await db.auditLog.count({ where: { actorId: admin.id, targetId: blocked.id, action: "PRODUCT_DELETE_BLOCKED" } })).toBe(1);

  await page.getByRole("button", { name: "Log out" }).click();
  const unauthenticated = await page.request.delete(`/api/admin/products/${blocked.id}/deletion`, { headers: { origin: "http://127.0.0.1:3000" }, data: { confirmationName: blocked.name } });
  expect(unauthenticated.status()).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email address").first().fill(customer.email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  const forbidden = await page.request.delete(`/api/admin/products/${blocked.id}/deletion`, { headers: { origin: "http://127.0.0.1:3000" }, data: { confirmationName: blocked.name } });
  expect(forbidden.status()).toBe(403);
});
