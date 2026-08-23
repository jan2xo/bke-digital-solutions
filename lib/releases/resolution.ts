import { db } from "@/lib/db";
import { CUSTOMER_RELEASE_LIFECYCLES } from "@/lib/releases/eligibility";

export async function resolveCurrentCustomerRelease(productId: string) {
  return db.productVersion.findFirst({
    where: { productId, active: true, publishedAt: { not: null }, lifecycle: { in: [...CUSTOMER_RELEASE_LIFECYCLES] } },
    orderBy: [{ publishedAt: "desc" }, { releasedAt: "desc" }, { version: "desc" }],
    select: { id: true, productId: true, version: true, externalUrl: true, publishedAt: true, releasedAt: true, lifecycle: true, active: true },
  });
}
