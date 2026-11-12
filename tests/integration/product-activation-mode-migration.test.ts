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
        licenseType: "Commercial",
      },
    });
    created.push(p.id);
    const rows = await db.$queryRaw<Array<{ activationMode: string }>>`
      SELECT COALESCE(policy."activationMode", 'EITHER') AS "activationMode"
        FROM "Product" p
        LEFT JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
       WHERE p."id" = ${p.id}
    `;
    expect(rows[0]?.activationMode).toBe("EITHER");
    expect(p.licenseType).toBe("Commercial");
    expect(allowsProductActivation(p.activationMode, "ACCOUNT")).toBe(true);
    expect(allowsProductActivation(p.activationMode, "LICENSE_KEY")).toBe(true);
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
        },
      });
      created.push(p.id);
      await db.$executeRaw`
        INSERT INTO "ProductActivationPolicy" ("productId", "activationMode")
        VALUES (${p.id}, ${mode})
      `;
      const rows = await db.$queryRaw<Array<{ activationMode: string }>>`
        SELECT COALESCE(policy."activationMode", 'EITHER') AS "activationMode"
          FROM "Product" p
          LEFT JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
         WHERE p."id" = ${p.id}
      `;
      const loaded = await db.product.findUniqueOrThrow({ where: { id: p.id } });
      expect(rows[0]?.activationMode).toBe(mode);
      expect(loaded.licenseType).toBe("Commercial");
      expect(allowsProductActivation(rows[0]?.activationMode, "ACCOUNT")).toBe(canAccount);
      expect(allowsProductActivation(rows[0]?.activationMode, "LICENSE_KEY")).toBe(canKey);
    }
  });

  it("database CHECK constraint rejects a fabricated activation credential mode", async () => {
    const id = created[0]!;
    await expect(db.$executeRaw`
      INSERT INTO "ProductActivationPolicy" ("productId", "activationMode")
      VALUES (${id}, 'GOOGLE_ONLY')
    `).rejects.toThrow();
    const original = await db.$queryRaw<Array<{ activationMode: string }>>`
      SELECT COALESCE(policy."activationMode", 'EITHER') AS "activationMode"
        FROM "Product" p
        LEFT JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
       WHERE p."id" = ${id}
    `;
    expect(original[0]?.activationMode).toBe("EITHER");
  });
});
