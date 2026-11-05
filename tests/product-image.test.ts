import { beforeEach, describe, expect, it, vi } from "vitest";
import { isLegacyProductImageObjectKey, resolveProductImageUrl } from "@/apps/web/catalog/product-image";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  txFindProduct: vi.fn(),
  txUpdateProduct: vi.fn(),
  cleanupUpsert: vi.fn(),
  productFindUnique: vi.fn(),
  productUpdate: vi.fn(),
  productCreate: vi.fn(),
  productCount: vi.fn(),
}));

vi.mock("@/apps/web/auth/session", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/apps/web/audit", () => ({ audit: mocks.audit }));
vi.mock("@/apps/web/config/environment", () => ({
  getWebHostEnvironment: () => ({ appUrl: "https://shop.test", trustedOrigins: [], trustProxyHops: 1 }),
}));
vi.mock("@/apps/web/storage/cleanup", () => ({
  storageCleanupIdempotencyKey: (type: string, target: string, objectKey: string) => type + ":" + target + ":" + objectKey,
}));
vi.mock("@/platform/host/db", () => ({
  db: {
    $transaction: mocks.transaction,
    product: {
      findUniqueOrThrow: mocks.productFindUnique,
      update: mocks.productUpdate,
      create: mocks.productCreate,
      count: mocks.productCount,
    },
    productVersion: { count: mocks.productCount },
    license: { count: mocks.productCount },
    subscription: { count: mocks.productCount },
    orderItem: { count: mocks.productCount },
  },
}));

const valid = "https://raw.githubusercontent.com/jan2xo/bke-digital-solutions/main/public/bke-icon.png";
const productId = "product-1";

function request(path: string, body: unknown, origin = "https://shop.test", method = "POST") {
  return new Request("https://shop.test" + path, {
    method,
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postImage(body: unknown, origin?: string) {
  const { POST } = await import("@/app/api/admin/products/[id]/image/route");
  return POST(request("/api/admin/products/" + productId + "/image", body, origin), { params: Promise.resolve({ id: productId }) });
}

describe("product GitHub image references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.audit.mockResolvedValue(undefined);
    mocks.txFindProduct.mockResolvedValue({ imageKey: null });
    mocks.txUpdateProduct.mockResolvedValue({ id: productId });
    mocks.cleanupUpsert.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      product: { findUniqueOrThrow: mocks.txFindProduct, update: mocks.txUpdateProduct },
      storageCleanupJob: { upsert: mocks.cleanupUpsert },
    }));
  });

  it("accepts canonical public raster images from the BKE owner", () => {
    expect(resolveProductImageUrl(valid)).toBe(valid);
  });

  it.each([
    "https://github.com/jan2xo/repo/blob/main/image.png",
    "https://raw.githubusercontent.com.evil.example/jan2xo/repo/main/image.png",
    "https://attacker@raw.githubusercontent.com/jan2xo/repo/main/image.png",
    "https://raw.githubusercontent.com:443/jan2xo/repo/main/image.png",
    "https://raw.githubusercontent.com/jan2xo/repo/main/image.png?token=secret",
    "https://raw.githubusercontent.com/jan2xo/repo/main/image.png#fragment",
    "https://raw.githubusercontent.com/jan2xo/repo/main/image.svg",
    "products/product-1/images/legacy.png",
  ])("rejects untrusted or non-raster reference %s", (value) => {
    expect(resolveProductImageUrl(value)).toBeNull();
  });

  it("recognizes only the prior UUID product-image object-key format", () => {
    expect(isLegacyProductImageObjectKey("products/product-1/images/123e4567-e89b-42d3-a456-426614174000.webp", productId)).toBe(true);
    expect(isLegacyProductImageObjectKey(valid, productId)).toBe(false);
    expect(isLegacyProductImageObjectKey("products/other/images/123e4567-e89b-42d3-a456-426614174000.webp", productId)).toBe(false);
  });

  it.each([["missing", "UNAUTHENTICATED", 401], ["forbidden", "FORBIDDEN", 403]] as const)(
    "prevents database writes for %s administrators",
    async (_label, errorCode, status) => {
      mocks.requireAdmin.mockRejectedValue(new Error(errorCode));
      const response = await postImage({ url: valid });
      expect(response.status).toBe(status);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it("rejects a bad origin before admin lookup or database writes", async () => {
    const response = await postImage({ url: valid }, "https://attacker.test");
    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid URL before opening a database transaction", async () => {
    const response = await postImage({ url: "https://github.com/jan2xo/repo/blob/main/image.png" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "INVALID_IMAGE_URL" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("stores a validated URL inside the transaction and queues no S3 cleanup for a previous GitHub URL", async () => {
    mocks.txFindProduct.mockResolvedValue({ imageKey: valid });
    const response = await postImage({ url: "https://raw.githubusercontent.com/jan2xo/bke-digital-solutions/main/public/other.png" });
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.txFindProduct).toHaveBeenCalledOnce();
    expect(mocks.transaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.txFindProduct.mock.invocationCallOrder[0]);
    expect(mocks.txUpdateProduct).toHaveBeenCalledWith({ where: { id: productId }, data: { imageKey: "https://raw.githubusercontent.com/jan2xo/bke-digital-solutions/main/public/other.png" } });
    expect(mocks.cleanupUpsert).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { source: "github", cleanupPending: false } }));
  });

  it("queues only the exact previous legacy image key when replacing it", async () => {
    const legacyKey = "products/product-1/images/123e4567-e89b-42d3-a456-426614174000.webp";
    mocks.txFindProduct.mockResolvedValue({ imageKey: legacyKey });
    const response = await postImage({ url: valid });
    expect(response.status).toBe(200);
    expect(mocks.cleanupUpsert).toHaveBeenCalledOnce();
    expect(mocks.cleanupUpsert.mock.calls[0]?.[0]).toMatchObject({
      create: { objectKey: legacyKey, targetType: "ProductImage", targetId: productId },
    });
  });

  it("returns INVALID_IMAGE_URL before unrelated validation or writes on product create and update", async () => {
    const create = await import("@/app/api/admin/products/route");
    const patch = await import("@/app/api/admin/products/[id]/route");
    const createResponse = await create.POST(request("/api/admin/products", { imageKey: "https://evil.test/image.png" }));
    const patchResponse = await patch.PATCH(request("/api/admin/products/" + productId, { imageKey: "products/" + productId + "/images/old.png" }, "https://shop.test", "PATCH"), { params: Promise.resolve({ id: productId }) });
    expect(await createResponse.json()).toEqual({ error: "INVALID_IMAGE_URL" });
    expect(await patchResponse.json()).toEqual({ error: "INVALID_IMAGE_URL" });
    expect(mocks.productFindUnique).not.toHaveBeenCalled();
    expect(mocks.productCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
