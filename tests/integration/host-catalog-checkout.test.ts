import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { createCatalogLookupCapability } from "@bke/catalog/logic/catalog";
import { createPostgresCatalogRepository } from "@bke/catalog/prisma/repositories/postgres-catalog-repository";
import { createHostCatalogLookupRepository } from "../../apps/web/catalog/lookup-repository";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
afterAll(async () => db.$disconnect());

describe("V3 Catalog Product/Edition checkout receiving (real PostgreSQL)", () => {
  const lookup = createCatalogLookupCapability({
    ...createPostgresCatalogRepository(process.env.DATABASE_URL!),
    ...createHostCatalogLookupRepository(db),
  });

  it("resolves a seeded published purchase plan's actual V3 Product and Edition", async () => {
    const plan = await db.purchasePlan.findFirst({
      where: {
        type: "PERPETUAL",
        active: true,
        edition: {
          active: true,
          product: { slug: "bke-deskflow", active: true, archivedAt: null },
        },
      },
      include: { edition: { include: { product: true } } },
    });
    expect(plan, "Catalog seed must include BKE DeskFlow's perpetual plan").not.toBeNull();
    const edition = await lookup.findEditionById(plan!.editionId);
    expect(edition.status).toBe("FOUND");
    if (edition.status !== "FOUND") return;
    expect(edition.value.id).toBe(plan!.edition.id);
    expect(edition.value.productId).toBe(plan!.edition.productId);
    expect(edition.value.active).toBe(true);
    const product = await lookup.findProductById(edition.value.productId);
    expect(product.status).toBe("FOUND");
    if (product.status !== "FOUND") return;
    expect(product.value.id).toBe(plan!.edition.product.id);
    expect(product.value.kind).toBe("SOFTWARE");
    expect(product.value.available).toBe(true);
    const bySlug = await lookup.findProductBySlug(plan!.edition.product.slug);
    expect(bySlug).toEqual(product);
    const editions = await lookup.listEditions(product.value.id);
    expect(editions.status).toBe("FOUND");
    if (editions.status === "FOUND") {
      expect(editions.values.map(x => x.id)).toContain(edition.value.id);
    }
  });

  it("keeps nonexistent IDs and invalid inputs fail-closed through the catalog capability", async () => {
    expect(await lookup.findEditionById("nonexistent-edition")).toEqual({ status: "NOT_FOUND" });
    expect(await lookup.findProductById("nonexistent-product")).toEqual({ status: "NOT_FOUND" });
    expect(await lookup.findProductBySlug("NON-VALID SLUG!")).toEqual({
      status: "FAILED",
      code: "INVALID_INPUT",
    });
  });
});
