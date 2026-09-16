import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { resolveProductBroadcasts } from "@/platform/notifications/product-broadcasts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get("product_id") ?? "";
  const version = request.nextUrl.searchParams.get("version") ?? "";

  try {
    const broadcasts = await resolveProductBroadcasts({ productId, version });
    return NextResponse.json(
      {
        capabilityId: "bke.product-broadcasts",
        contractVersion: 1,
        source: "bke-digital-solutions",
        productId,
        version,
        broadcasts: broadcasts.map((broadcast) => ({
          broadcastId: broadcast.broadcastId,
          code: broadcast.code,
          audience: broadcast.audience,
          priority: broadcast.priority,
          deliveryMode: broadcast.deliveryMode,
          minimumVersion: broadcast.minimumVersion,
          maximumVersion: broadcast.maximumVersion,
          publishedAt: broadcast.publishedAt,
          startsAt: broadcast.startsAt,
          endsAt: broadcast.endsAt,
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError || (error instanceof Error && error.message === "INVALID_VERSION")) {
      return NextResponse.json(
        { error: "invalid_product_broadcast_request" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof Error && error.message === "NOT_FOUND") {
      return NextResponse.json(
        { error: "unknown_product" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    throw error;
  }
}
