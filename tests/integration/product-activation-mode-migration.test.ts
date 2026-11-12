import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/platform/persistence/generated/prisma/client";
import { allowsProductActivation } from "@/apps/web/licensing/product-activation-mode";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const created: string[] = [];
const suffix = `${Date.now().toString(36)}-${process.pid}`;

describe.runIf(process.env.BKE_PRODUCT_ACTIVATION_DB_PROOF === "1")(
  "dual-path activation mode migration — disposable PostgreSQL",
  { concurrent: false }, () => {
  afterAll(async () => {
    for (const id of created.reverse()) {
      await db.product.delete({ where: { id } }).catch(() => undefined);
    }
    await db.$disconnect();
  });

  it("backward-compatibly defaults a new commercial product to EITHER", async () => {
    const p = await db.product.create({
      data: {
        slug: `dual-path-default-${suffix}`,
        name: "License Key Compatible Fixture",
        summary: "Legacy software can still activate with a purchased key.",
        description: "Disposable product used to prove the additive licensing activation-mode migration.",
        type: "SOFTWARE",
        active: false,
        licenseType: "Commercial",
      },
    });
    created.push(p.id);
    const rows = await db.$queryRaw<Array<{ activationMode: string }>>`
      SELECT policy."activationMode" AS "activationMode"
        FROM "Product" p
        JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
       WHERE p."id" = ${p.id}
    `;
    expect(rows[0]?.activationMode).toBe("EITHER");
    expect(p.licenseType).toBe("Commercial");
    expect(allowsProductActivation(rows[0]?.activationMode, "ACCOUNT")).toBe(true);
    expect(allowsProductActivation(rows[0]?.activationMode, "LICENSE_KEY")).toBe(true);
  });

  it("round-trips explicit ACCOUNT and LICENSE_KEY without changing licenseType", async () => {
    for (const [mode, canAccount, canKey] of [
      ["ACCOUNT", true, false],
      ["LICENSE_KEY", false, true],
    ] as const) {
      const p = await db.product.create({
        data: {
          slug: `dual-path-${mode.toLowerCase()}-${suffix}`,
          name: `Activation ${mode} Fixture`,
          summary: "Product can choose account or license key activation explicitly.",
          description: "Disposable product verifying no Google login requirement is baked into license key.",
          type: "SOFTWARE",
          active: false,
        },
      });
      created.push(p.id);
      await db.$executeRaw`
        UPDATE "ProductActivationPolicy" SET "activationMode" = ${mode}
         WHERE "productId" = ${p.id}
      `;
      const rows = await db.$queryRaw<Array<{ activationMode: string }>>`
        SELECT policy."activationMode" AS "activationMode"
          FROM "Product" p
          JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
         WHERE p."id" = ${p.id}
      `;
      const loaded = await db.product.findUniqueOrThrow({ where: { id: p.id } });
      expect(rows[0]?.activationMode).toBe(mode);
      expect(loaded.licenseType).toBe("Commercial");
      expect(allowsProductActivation(rows[0]?.activationMode, "ACCOUNT")).toBe(canAccount);
      expect(allowsProductActivation(rows[0]?.activationMode, "LICENSE_KEY")).toBe(canKey);
    }
  });

  it("remembers publication permanently even after an unpublish operation", async () => {
    const id = created[0]!;
    await db.product.update({
      where: { id }, data: { active: true, publishedAt: new Date() },
    });
    await db.product.update({
      where: { id }, data: { active: false, publishedAt: null },
    });
    const rows = await db.$queryRaw<Array<{
      activationMode: string;
      publishedEver: boolean;
    }>>`
      SELECT "activationMode", "publishedEver"
        FROM "ProductActivationPolicy" WHERE "productId" = ${id}
    `;
    expect(rows).toEqual([{ activationMode: "EITHER", publishedEver: true }]);
  });

  it("backfills and creates policy for every disposable product", async () => {
    const rows = await db.$queryRaw<Array<{ missing: bigint }>>`
      SELECT COUNT(*) AS "missing" FROM "Product" p
      LEFT JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
      WHERE policy."productId" IS NULL
    `;
    expect(rows[0]?.missing).toBe(0n);
  });

  it("remembers publication permanently across unpublish", async () => {
    const id = created[0]!;
    const baseline = await db.$queryRaw<Array<{ publishedEver: boolean }>>`
      SELECT "publishedEver" FROM "ProductActivationPolicy" WHERE "productId" = ${id}
    `;
    expect(baseline).toEqual([{ publishedEver: false }]);
    const published = await db.product.update({
      where: { id },
      data: { active: true, publishedAt: new Date("2026-11-12T00:00:00Z") },
    });
    expect(published.active).toBe(true);
    await db.product.update({
      where: { id },
      data: { active: false, publishedAt: null },
    });
    const history = await db.$queryRaw<Array<{ publishedEver: boolean }>>`
      SELECT "publishedEver" FROM "ProductActivationPolicy" WHERE "productId" = ${id}
    `;
    expect(history).toEqual([{ publishedEver: true }]);
  });

  it("database CHECK constraint rejects a fabricated activation credential mode", async () => {
    const id = created[0]!;
    await expect(db.$executeRaw`
      UPDATE "ProductActivationPolicy" SET "activationMode" = 'GOOGLE_ONLY'
       WHERE "productId" = ${id}
    `).rejects.toThrow();
    const original = await db.$queryRaw<Array<{ activationMode: string }>>`
      SELECT policy."activationMode" AS "activationMode"
        FROM "Product" p
        JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
       WHERE p."id" = ${id}
    `;
    expect(original[0]?.activationMode).toBe("EITHER");
  });
});
