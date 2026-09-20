ALTER TABLE "Product" ADD COLUMN "productId" TEXT;

CREATE UNIQUE INDEX "Product_productId_key" ON "Product"("productId");
