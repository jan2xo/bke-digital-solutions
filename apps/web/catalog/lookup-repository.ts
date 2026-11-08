import "server-only";
import {
  CATALOG_PRODUCT_KINDS,
  type CatalogProductKind,
  type CatalogProductSnapshot,
  type CatalogEditionSnapshot,
} from "@bke/catalog/contracts/catalog.contract";
import type { CatalogRepository } from "@bke/catalog/logic/catalog-repository";
import { db } from "@/platform/host/db";

// V3 continues to use canonical Product and Edition tables. The immutable
// @bke/catalog domain owns lookup validation; this adapter owns only storage.
type HostCatalogClient = Pick<typeof db, "product" | "edition">;
const catalogKinds = new Set<string>(CATALOG_PRODUCT_KINDS);

function snapshotProduct(row: NonNullable<Awaited<ReturnType<HostCatalogClient["product"]["findUnique"]>>>): CatalogProductSnapshot {
  if (!catalogKinds.has(row.type)) throw new Error("CATALOG_PRODUCT_KIND_UNSUPPORTED");
  return Object.freeze({
    id: row.id,
    slug: row.slug,
    productId: row.productId,
    name: row.name,
    summary: row.summary,
    description: row.description,
    kind: row.type as CatalogProductKind,
    category: row.category,
    featured: row.featured,
    imageKey: row.imageKey,
    tags: Object.freeze([...row.tags]),
    active: row.active,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    available: row.active && row.publishedAt !== null && row.archivedAt === null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function snapshotEdition(row: NonNullable<Awaited<ReturnType<HostCatalogClient["edition"]["findUnique"]>>>): CatalogEditionSnapshot {
  return Object.freeze({
    id: row.id,
    productId: row.productId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    features: row.features,
    maxUsers: row.maxUsers,
    maxDevicesPerUser: row.maxDevicesPerUser,
    updatePolicy: row.updatePolicy,
    active: row.active,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function createHostCatalogLookupRepository(
  client: HostCatalogClient = db,
): Pick<CatalogRepository, "findProductById" | "findProductBySlug" | "findEditionById" | "listEditions"> {
  return Object.freeze({
    async findProductById(id: string) {
      const product = await client.product.findUnique({ where: { id } });
      return product ? snapshotProduct(product) : null;
    },
    async findProductBySlug(slug: string) {
      const product = await client.product.findUnique({ where: { slug } });
      return product ? snapshotProduct(product) : null;
    },
    async findEditionById(id: string) {
      const edition = await client.edition.findUnique({ where: { id } });
      return edition ? snapshotEdition(edition) : null;
    },
    async listEditions(productId: string) {
      const editions = await client.edition.findMany({
        where: { productId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      return Object.freeze(editions.map(snapshotEdition));
    },
  });
}
