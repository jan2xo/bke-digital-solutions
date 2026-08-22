import "dotenv/config";
import argon2 from "argon2";
import { test, expect } from "@playwright/test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { enrollAndLoginAdmin } from "./mfa-helper";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
test.afterAll(() => db.$disconnect());

test("administrator can inspect Phase 5 control-plane surfaces", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `phase5-${suffix}@bke.test`;
  await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash("Phase5-Certification-2026!") } } } });
  await enrollAndLoginAdmin(page, email, "Phase5-Certification-2026!");
  for (const path of ["/admin/releases", "/admin/subscriptions", "/admin/scanner", "/admin/security/commercial-signing-keys", "/admin/backups"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
  }
  await expect(page.getByText("Subscriptions", { exact: true })).toBeVisible();
});

test("protected control-plane APIs reject anonymous access", async ({ request }) => {
  for (const path of ["/api/admin/security/commercial-signing-keys", "/api/admin/backups"]) {
    const response = await request.get(path);
    expect([401, 403], path).toContain(response.status());
  }
});

test("artifact confirmation cancellation does not mutate, confirmation does", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `phase5-artifact-${suffix}@bke.test`;
  const password = "Phase5-Certification-2026!";
  await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  const product = await db.product.create({ data: { slug: `phase5-${suffix}`, name: `Phase 5 ${suffix}`, summary: "Certification fixture", description: "Certification fixture", type: "SOFTWARE", active: true } });
  const version = await db.productVersion.create({ data: { productId: product.id, version: "1.0.0", operatingSystem: "Windows", architecture: "x64", releaseNotes: "Certification fixture", lifecycle: "DRAFT" } });
  const artifact = await db.productArtifact.create({ data: { productId: product.id, versionId: version.id, name: "phase5.zip", objectKey: `certification/${suffix}/phase5.zip`, sha256: "a".repeat(64), sizeBytes: 13, contentType: "application/zip", active: true } });
  await page.goto(`/admin/releases/${version.id}`);
  let deletes = 0;
  page.on("request", (request) => { if (request.method() === "DELETE" && request.url().includes(`/api/admin/artifacts/${artifact.id}`)) deletes += 1; });
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Remove" }).click();
  await page.waitForTimeout(250);
  expect(deletes).toBe(0);
  expect((await db.productArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).active).toBe(true);
  const deletion = page.waitForResponse((response) => response.url().includes(`/api/admin/artifacts/${artifact.id}`) && response.request().method() === "DELETE");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Remove" }).click();
  expect((await deletion).status()).toBe(200);
  expect((await db.productArtifact.findUniqueOrThrow({ where: { id: artifact.id } })).active).toBe(false);
});

test("release readiness is rendered from the server evaluator", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const email = `phase5-readiness-${suffix}@bke.test`;
  const password = "Phase5-Certification-2026!";
  await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  const product = await db.product.create({ data: { slug: `phase5-readiness-${suffix}`, name: `Readiness ${suffix}`, summary: "Certification fixture", description: "Certification fixture", type: "SOFTWARE", active: true } });
  const version = await db.productVersion.create({ data: { productId: product.id, version: "1.0.0", operatingSystem: "Windows", architecture: "x64", releaseNotes: "Certification fixture", lifecycle: "DRAFT" } });
  await db.productArtifact.create({ data: { productId: product.id, versionId: version.id, name: "readiness.zip", objectKey: `certification/${suffix}/readiness.zip`, sha256: "c".repeat(64), sizeBytes: 1, contentType: "application/zip", active: true } });
  await db.supplyChainEvidence.create({ data: { versionId: version.id, releaseIdentifier: `phase5-${suffix}`, commitHash: "c".repeat(40), branch: "certification", buildEnvironment: "certification", builderIdentity: "phase5-test", builtAt: new Date() } });
  await page.goto(`/admin/releases/${version.id}`);
  await expect(page.getByRole("heading", { name: "Release readiness" })).toBeVisible();
  await expect(page.getByText("PUBLISH:").locator("..")).toContainText("BLOCKED");
  await expect(page.getByText(/Signature|Malware|SBOM|Provenance/).first()).toBeVisible();
  const sign = page.waitForResponse((response) => response.url().endsWith("/api/admin/supply-chain") && response.request().method() === "POST");
  page.once("dialog", (dialog) => void dialog.accept()); await page.getByRole("button", { name: "Sign" }).click(); const signResponse = await sign; expect(signResponse.status(), await signResponse.text()).toBe(200);
  await page.reload(); await expect(page.getByText(/SIGNATURE/).first()).toBeVisible();
  const add = page.locator('input[type="file"][name="installer"]'); await add.setInputFiles({ name: "readiness-2.zip", mimeType: "application/zip", buffer: Buffer.from("new readiness artifact") }); const added = page.waitForResponse((response) => response.url().endsWith(`/api/admin/versions/${version.id}/artifacts`) && response.request().method() === "POST"); await page.getByRole("button", { name: "Add artifact" }).click(); expect((await added).status()).toBe(201); await page.reload(); await expect(page.getByText("PUBLISH:").locator("..")).toContainText("BLOCKED");
});

test("scanner page reports the live ClamAV state", async ({ page }) => {
  const suffix = Date.now().toString(36); const email = `phase5-scanner-${suffix}@bke.test`; const password = "Phase5-Certification-2026!";
  await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  await page.goto("/admin/scanner");
  const expected = process.env.PHASE5_SCANNER_EXPECTED ?? "HEALTHY";
  await expect(page.locator("p").filter({ hasText: `Status: ${expected}` })).toBeVisible();
});

test("backup confirmations and durable polling use persisted operation state", async ({ page }) => {
  const suffix = Date.now().toString(36); const email = `phase5-backup-${suffix}@bke.test`; const password = "Phase5-Certification-2026!";
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  const archive = await db.backupArchive.create({ data: { status: "AVAILABLE", retentionTier: "MANUAL", deploymentId: `certification-${suffix}`, storagePrefix: `certification/${suffix}`, objectCount: 0, sizeBytes: 0n } });
  const expired = await db.backupArchive.create({ data: { status: "EXPIRED", retentionTier: "MANUAL", deploymentId: `certification-${suffix}-expired`, storagePrefix: `certification/${suffix}/expired`, objectCount: 0, sizeBytes: 0n, expiresAt: new Date(Date.now() - 1000) } });
  await page.goto("/admin/backups");
  let requests = 0; page.on("request", (request) => { if (request.url().includes(`/api/admin/backups/${archive.id}/actions`)) requests += 1; });
  page.once("dialog", (dialog) => void dialog.dismiss());
  const availableRow = page.locator("tr").filter({ hasText: "AVAILABLE" }).first();
  await availableRow.getByRole("button", { name: "Simulate restore" }).click();
  await page.waitForTimeout(200); expect(requests).toBe(0);
  const queued = page.waitForResponse((response) => response.url().includes(`/api/admin/backups/${archive.id}/actions`) && response.request().method() === "POST");
  page.once("dialog", (dialog) => void dialog.accept());
  await availableRow.getByRole("button", { name: "Simulate restore" }).click();
  expect((await queued).status()).toBe(202);
  const op = await db.backupOperation.findFirstOrThrow({ where: { backupId: archive.id, type: "SIMULATE_RESTORE", requestedById: admin.id } });
  expect(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].map(String)).toContain(String(op.status));
  let expiredRequests = 0; page.on("request", (request) => { if (request.url().includes(`/api/admin/backups/${expired.id}/actions`)) expiredRequests += 1; });
  page.once("dialog", (dialog) => void dialog.dismiss());
  const expiredRow = page.locator("tr").filter({ hasText: "EXPIRED" }).first();
  await expiredRow.getByRole("button", { name: "Delete expired" }).click();
  await page.waitForTimeout(200); expect(expiredRequests).toBe(0);
  const deleteResponse = page.waitForResponse((response) => response.url().includes(`/api/admin/backups/${expired.id}/actions`) && response.request().method() === "POST");
  page.once("dialog", (dialog) => void dialog.accept());
  await expiredRow.getByRole("button", { name: "Delete expired" }).click();
  expect((await deleteResponse).status()).toBe(202);
});

test("license reveal and transfer confirmations use protected operations", async ({ page }) => {
  const suffix = Date.now().toString(36); const email = `phase5-license-${suffix}@bke.test`; const password = "Phase5-Certification-2026!";
  const admin = await db.user.create({ data: { email, emailVerified: new Date(), role: "ADMIN", credential: { create: { passwordHash: await argon2.hash(password) } } } });
  await enrollAndLoginAdmin(page, email, password);
  const source = await db.user.create({ data: { email: `source-${suffix}@bke.test`, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: `Source ${suffix}`, billingEmail: `source-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
  const destination = await db.user.create({ data: { email: `destination-${suffix}@bke.test`, emailVerified: new Date(), ownedAccounts: { create: { type: "INDIVIDUAL", displayName: `Destination ${suffix}`, billingEmail: `destination-${suffix}@bke.test` } } }, include: { ownedAccounts: true } });
  const product = await db.product.create({ data: { productId: `phase5-license-${suffix}`, slug: `phase5-license-${suffix}`, name: `License ${suffix}`, summary: "Certification fixture", description: "Certification fixture", type: "SOFTWARE", active: true } });
  const release = await db.productVersion.create({ data: { productId: product.id, version: "1.0.0", operatingSystem: "Windows", architecture: "x64", releaseNotes: "Certification", lifecycle: "STABLE", releasedAt: new Date(), isLatest: true } });
  await db.productArtifact.create({ data: { productId: product.id, versionId: release.id, name: "phase5.zip", objectKey: `certification/${suffix}/license.zip`, sha256: "b".repeat(64), sizeBytes: 1, contentType: "application/zip", active: true } });
  const policy = await db.licensePolicy.create({ data: { productId: product.id, name: "Transferable certification", transferable: true, maxSeats: 1, maxDevicesPerSeat: 1 } });
  const price = await db.price.create({ data: { productId: product.id, licensePolicyId: policy.id, name: "Certification", amountMinor: 100, billingType: "ONE_TIME" } });
  const order = await db.order.create({ data: { number: `PH5-${suffix}`, accountId: source.ownedAccounts[0]!.id, status: "PAID", currency: "PHP", subtotalMinor: 100, taxMinor: 0, totalMinor: 100, billingSnapshot: {}, paidAt: new Date(), items: { create: { productId: product.id, priceId: price.id, policyId: policy.id, productName: product.name, priceName: price.name, quantity: 1, unitAmountMinor: 100, totalMinor: 100, billingType: "ONE_TIME", policySnapshot: { transferable: true } } } } });
  const key = `BKE-${randomBytes(12).toString("hex").toUpperCase()}`; const hashLicenseKey = (value: string) => createHmac("sha256", process.env.LICENSE_PEPPER!).update(value).digest("hex"); const encryptLicenseKey = (value: string) => { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(process.env.LICENSE_PEPPER!).digest(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join("."); }; 
  const license = await db.license.create({ data: { publicId: `PH5-${suffix}`, keyHash: hashLicenseKey(key), keyLastFour: key.slice(-4), keyCiphertext: encryptLicenseKey(key), accountId: source.ownedAccounts[0]!.id, orderId: order.id, orderItemId: (await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })).id, productId: product.id, status: "ACTIVE", maxSeats: 1, maxDevicesPerSeat: 2 } });
  await db.deviceActivation.create({ data: { licenseId: license.id, deviceHash: `phase5-device-hash-${suffix}`, label: "Certification device", active: true } });
  await db.licenseLeaseRecord.create({ data: { licenseId: license.id, leaseId: `phase5-source-lease-${suffix}`, generation: 1, serverRevision: 1, installationId: `phase5-source-installation-${suffix}`, deviceId: `phase5-source-device-${suffix}`, version: "1.0.0", status: "ACTIVE", action: "ACTIVATION" } });
  await page.goto("/admin/licenses"); const row = page.locator("tr").filter({ hasText: license.keyLastFour }).first();
  let reveals = 0; page.on("request", (request) => { if (request.url().includes(`/api/admin/licenses/${license.id}`) && request.method() === "PATCH") reveals += 1; });
  page.once("dialog", (dialog) => void dialog.dismiss()); await row.getByRole("button", { name: "Reveal license key" }).click(); await page.waitForTimeout(150); expect(reveals).toBe(0); await expect(row.getByText("••••")).toBeVisible();
  const revealResponse = page.waitForResponse((response) => response.url().includes(`/api/admin/licenses/${license.id}`) && response.request().method() === "PATCH"); page.once("dialog", (dialog) => void dialog.accept()); await row.getByRole("button", { name: "Reveal license key" }).click(); expect((await revealResponse).status()).toBe(200);
  await row.getByPlaceholder("Destination account ID").fill(destination.ownedAccounts[0]!.id); await row.getByPlaceholder("Target installation ID").fill("phase5-installation"); await row.getByPlaceholder("Target device ID").fill("phase5-device");
  const invalid = await page.request.patch(`/api/admin/licenses/${license.id}`, { headers: { origin: "http://jl-bke.localhost:8080" }, data: { action: "TRANSFER", accountId: "nonexistent-account", installationId: "phase5-installation", deviceId: "phase5-device" } }); expect([400, 403, 404, 409]).toContain(invalid.status());
  let transfers = 0; page.on("request", (request) => { if (request.url().includes(`/api/admin/licenses/${license.id}`) && request.method() === "PATCH") transfers += 1; }); page.once("dialog", (dialog) => void dialog.dismiss()); await row.getByRole("button", { name: "Transfer" }).click(); await page.waitForTimeout(150); expect(transfers).toBe(0);
  const transferResponse = page.waitForResponse((response) => response.url().includes(`/api/admin/licenses/${license.id}`) && response.request().method() === "PATCH"); page.once("dialog", (dialog) => void dialog.accept()); await row.getByRole("button", { name: "Transfer" }).click(); const transferResult = await transferResponse; const transferBody = await transferResult.json(); expect(transferResult.status(), JSON.stringify(transferBody)).toBe(200); expect((await db.license.findUniqueOrThrow({ where: { id: license.id } })).accountId).toBe(destination.ownedAccounts[0]!.id);
  await db.auditLog.deleteMany({ where: { actorId: admin.id } });
});
