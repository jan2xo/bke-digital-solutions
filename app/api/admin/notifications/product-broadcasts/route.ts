import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/apps/web/auth/session";
import { assertSameOrigin } from "@/apps/web/http/request";
import { apiError } from "@/apps/web/http/api-error";
import { rateLimit } from "@/apps/web/http/rate-limit";
import {
  endProductBroadcast,
  publishProductBroadcast,
} from "@/apps/web/notifications/product-broadcasts";
import {
  PRODUCT_BROADCAST_CODES,
  PRODUCT_BROADCAST_DELIVERY_MODES,
  PRODUCT_BROADCAST_PRIORITIES,
} from "@/apps/web/notifications/product-broadcast-contract";

const productId = z.string().trim().regex(/^[a-z][a-z0-9-]{1,127}$/);
const version = z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
const timestamp = z.string().trim().refine(
  (value) => Number.isFinite(new Date(value).getTime()),
  "Invalid timestamp",
);

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("PUBLISH"),
    operationId: z.string().uuid(),
    productId,
    version,
    code: z.enum(PRODUCT_BROADCAST_CODES),
    priority: z.enum(PRODUCT_BROADCAST_PRIORITIES).default("NORMAL"),
    deliveryMode: z.enum(PRODUCT_BROADCAST_DELIVERY_MODES).default("ONCE"),
    startsAt: timestamp.optional(),
    endsAt: timestamp.optional(),
  }).strict(),
  z.object({
    action: z.literal("END"),
    productId,
    version,
    broadcastId: z.string().uuid(),
  }).strict(),
]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(
      `admin-product-broadcast:${admin.id}`,
      60,
      3600,
    )).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const input = bodySchema.parse(await request.json());
    const result = input.action === "PUBLISH"
      ? await publishProductBroadcast({
          actorId: admin.id,
          operationId: input.operationId,
          productId: input.productId,
          version: input.version,
          code: input.code,
          priority: input.priority,
          deliveryMode: input.deliveryMode,
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
          endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        })
      : await endProductBroadcast({
          actorId: admin.id,
          productId: input.productId,
          version: input.version,
          broadcastId: input.broadcastId,
        });

    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
