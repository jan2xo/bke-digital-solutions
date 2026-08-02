import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

vi.hoisted(() => {
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.EMAIL_PROVIDER = "log";
  process.env.BKE_DISABLE_EXTERNAL_EMAIL = "true";
});
vi.mock("@/lib/env", () => ({ env: { DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test", SESSION_SECRET: process.env.SESSION_SECRET } }));
vi.mock("@/lib/email", () => ({ sendMagicLink: vi.fn().mockResolvedValue(undefined) }));

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = Date.now().toString(36);
const customerEmail = `magic-customer-${suffix}@bke.test`;
const missingEmail = `magic-missing-${suffix}@bke.test`;
const adminEmail = `magic-admin-${suffix}@bke.test`;
let issueMagicLinkForExistingCustomer: (email: string) => Promise<boolean>;

describe.sequential("magic-link account guardrail", () => {
  beforeAll(async () => {
    ({ issueMagicLinkForExistingCustomer } = await import("@/lib/auth/magic-link"));
  });
  afterAll(() => db.$disconnect());

  it("does not create a token for an email absent from the database", async () => {
    expect(await issueMagicLinkForExistingCustomer(missingEmail)).toBe(false);
    expect(await db.verificationToken.count({ where: { identifier: missingEmail, purpose: "MAGIC_LOGIN" } })).toBe(0);
  });

  it("creates a token only for an existing customer", async () => {
    await db.user.create({ data: { email: customerEmail, role: "CUSTOMER" } });
    expect(await issueMagicLinkForExistingCustomer(customerEmail)).toBe(true);
    expect(await db.verificationToken.count({ where: { identifier: customerEmail, purpose: "MAGIC_LOGIN", usedAt: null } })).toBe(1);
  });

  it("invalidates an earlier unused link before issuing another", async () => {
    expect(await issueMagicLinkForExistingCustomer(customerEmail)).toBe(true);
    expect(await db.verificationToken.count({ where: { identifier: customerEmail, purpose: "MAGIC_LOGIN", usedAt: null } })).toBe(1);
    expect(await db.verificationToken.count({ where: { identifier: customerEmail, purpose: "MAGIC_LOGIN", usedAt: { not: null } } })).toBe(1);
  });

  it("does not issue passwordless administrator access", async () => {
    await db.user.create({ data: { email: adminEmail, role: "ADMIN", emailVerified: new Date() } });
    expect(await issueMagicLinkForExistingCustomer(adminEmail)).toBe(false);
    expect(await db.verificationToken.count({ where: { identifier: adminEmail, purpose: "MAGIC_LOGIN" } })).toBe(0);
  });
});
