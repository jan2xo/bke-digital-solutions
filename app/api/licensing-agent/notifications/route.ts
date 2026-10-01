import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listProductBroadcasts } from "@/apps/web/notifications/product-broadcasts";
import { apiError } from "@/apps/web/http/api-error";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  product_id: z.string().trim().regex(/^[a-z][a-z0-9-]{1,127}$/),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
}).strict();

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  try {
    const input = querySchema.parse({
      product_id: request.nextUrl.searchParams.get("product_id"),
      version: request.nextUrl.searchParams.get("version"),
    });

    const result = await listProductBroadcasts({
      productId: input.product_id,
      version: input.version,
    });
    if (!result) return noStore({ error: "NOT_FOUND" }, 404);

    return noStore({
      capabilityId: "bke.product-broadcasts",
      contractVersion: 1,
      source: "bke-digital-solutions",
      productId: result.productId,
      version: result.version,
      broadcasts: result.broadcasts,
    });
  } catch (error) {
    return apiError(error);
  }
}
